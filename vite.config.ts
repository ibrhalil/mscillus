import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // three.js (~740 kB) yalnızca WebGL modlarında tembel yüklenen ayrı parçadır; ilk açılışı etkilemez.
    chunkSizeWarningLimit: 800,
  },
});
