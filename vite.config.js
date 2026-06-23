import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ownerRegister: resolve(__dirname, 'owner-register.html'),
        tenantRegister: resolve(__dirname, 'tenant-register.html'),
        ownerDashboard: resolve(__dirname, 'owner-dashboard.html'),
        tenantDashboard: resolve(__dirname, 'tenant-dashboard.html'),
        superadmin: resolve(__dirname, 'superadmin.html'),
        termsConditions: resolve(__dirname, 'terms-conditions.html'),
        privacyPolicy: resolve(__dirname, 'privacy-policy.html'),
        refundPolicy: resolve(__dirname, 'refund-policy.html'),
        subscriptionExpired: resolve(__dirname, 'subscription-expired.html'),
        accountLocked: resolve(__dirname, 'account-locked.html'),
      },
    },
    outDir: 'dist',
  },
})
