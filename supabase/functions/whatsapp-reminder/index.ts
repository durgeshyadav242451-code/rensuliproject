import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const { manual, tenantId, bulk, ownerId } = body;

    // Platform Default Meta Credentials
    const PLATFORM_ACCESS_TOKEN = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
    const PLATFORM_PHONE_ID = Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID");

    // Helper: Send Meta message and log to database
    const sendAndLogMessage = async (
      ownerSettings: any,
      tenant: any,
      dueAmt: number,
      dueDateFormatted: string
    ) => {
      // Determine credentials based on mode
      const usePersonal = ownerSettings?.api_mode === "personal";
      const accessToken = usePersonal ? ownerSettings.meta_access_token : PLATFORM_ACCESS_TOKEN;
      const phoneId = usePersonal ? ownerSettings.meta_phone_number_id : PLATFORM_PHONE_ID;
      
      const templateName = ownerSettings?.meta_template_name || "rent_reminder";
      const templateLang = ownerSettings?.meta_template_language || "en";

      const previewText = `Tenant: ${tenant.name}, Room: ${tenant.room_number}, Amount: ${dueAmt}, Due Date: ${dueDateFormatted}`;

      if (!accessToken || !phoneId) {
        // Log failure - missing config
        await supabaseClient.from("whatsapp_reminder_logs").insert({
          owner_id: tenant.owner_id,
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          phone: tenant.phone,
          message_preview: previewText,
          status: "failed",
          error_message: "Missing Meta API credentials (access token or phone ID)."
        });
        return { success: false, error: "Missing configuration" };
      }

      // Parameters: {{1}} = Name, {{2}} = Amount, {{3}} = Building Name, {{4}} = Due Date
      const templateParams = [
        tenant.name,
        String(dueAmt),
        tenant.buildings?.name || "PG",
        dueDateFormatted
      ];

      try {
        let cleanPhone = tenant.phone.replace(/\D/g, "");
        if (!cleanPhone.startsWith("91") && cleanPhone.length === 10) {
          cleanPhone = "91" + cleanPhone;
        }

        const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: cleanPhone,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLang },
              components: [
                {
                  type: "body",
                  parameters: templateParams.map(param => ({ type: "text", text: param }))
                }
              ]
            }
          })
        });

        const resData = await res.json();
        if (!res.ok) {
          throw new Error(resData.error?.message || "Meta API returns error status");
        }

        // Log success
        await supabaseClient.from("whatsapp_reminder_logs").insert({
          owner_id: tenant.owner_id,
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          phone: tenant.phone,
          message_preview: previewText,
          status: "sent"
        });

        return { success: true };

      } catch (err: any) {
        // Log failure
        await supabaseClient.from("whatsapp_reminder_logs").insert({
          owner_id: tenant.owner_id,
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          phone: tenant.phone,
          message_preview: previewText,
          status: "failed",
          error_message: err.message || String(err)
        });
        return { success: false, error: err.message };
      }
    };

    // Helper: Format date as DD/MM/YYYY
    const formatDate = (dateStr: string) => {
      if (!dateStr) return "—";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "—";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // ── Mode 1: Individual Manual Send ──
    if (manual && tenantId) {
      const { data: tenant, error: tErr } = await supabaseClient
        .from("tenants")
        .select("*, buildings(name)")
        .eq("id", tenantId)
        .single();
        
      if (tErr || !tenant) {
        return new Response(JSON.stringify({ error: "Tenant not found: " + (tErr?.message || "") }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404
        });
      }

      // Check current rent status
      const { data: settings } = await supabaseClient
        .from("owner_whatsapp_settings")
        .select("*")
        .eq("owner_id", tenant.owner_id)
        .maybeSingle();

      const dueAmount = (tenant.monthly_rent || 0) + (tenant.maintenance_charge || 0);
      const dueDate = tenant.next_due_date || new Date().toISOString();

      const res = await sendAndLogMessage(settings, tenant, dueAmount, formatDate(dueDate));

      return new Response(JSON.stringify(res), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Mode 2: Bulk Manual Send ──
    if (bulk && ownerId) {
      const { data: settings } = await supabaseClient
        .from("owner_whatsapp_settings")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle();

      // Fetch unpaid tenants
      const { data: tenants, error: tsErr } = await supabaseClient
        .from("tenants")
        .select("*, buildings(name)")
        .eq("owner_id", ownerId)
        .in("status", ["active", "vacating"]);

      if (tsErr || !tenants) {
        return new Response(JSON.stringify({ error: "Failed to load tenants: " + (tsErr?.message || "") }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500
        });
      }

      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const tenant of tenants) {
        // Only send if due amount is positive
        const dueAmount = (tenant.monthly_rent || 0) + (tenant.maintenance_charge || 0);
        if (dueAmount <= 0) {
          skipped++;
          continue;
        }

        const dueDate = tenant.next_due_date || new Date().toISOString();
        const res = await sendAndLogMessage(settings, tenant, dueAmount, formatDate(dueDate));
        if (res.success) {
          sent++;
        } else {
          failed++;
        }
      }

      return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── Mode 3: Automatic Cron Execution (Daily Routine) ──
    // Fetch all owners with reminders enabled
    const { data: allSettings, error: sErr } = await supabaseClient
      .from("owner_whatsapp_settings")
      .select("*")
      .eq("reminder_enabled", true);

    if (sErr || !allSettings) {
      return new Response(JSON.stringify({ error: "Failed to load active settings: " + (sErr?.message || "") }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      });
    }

    let totalSent = 0;
    let totalFailed = 0;

    for (const setting of allSettings) {
      const targetDays = setting.reminder_days || 2;
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + targetDays);
      const targetDateStr = targetDate.toISOString().slice(0, 10); // YYYY-MM-DD

      // Fetch tenants under this owner whose next_due_date matches targetDateStr
      const { data: tenants } = await supabaseClient
        .from("tenants")
        .select("*, buildings(name)")
        .eq("owner_id", setting.owner_id)
        .in("status", ["active", "vacating"])
        .eq("next_due_date", targetDateStr);

      if (tenants) {
        for (const tenant of tenants) {
          const dueAmount = (tenant.monthly_rent || 0) + (tenant.maintenance_charge || 0);
          if (dueAmount > 0) {
            const res = await sendAndLogMessage(setting, tenant, dueAmount, formatDate(tenant.next_due_date));
            if (res.success) totalSent++;
            else totalFailed++;
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, cron: true, sent: totalSent, failed: totalFailed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});
