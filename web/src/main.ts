import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import App from './App.vue';
import { router } from './router.ts';
import './style.css';

// iOS negeert user-scalable=no in de viewport; knijpen om te zoomen blokkeren we daarom hier.
document.addEventListener('gesturestart', (e) => e.preventDefault());

createApp(App).use(createPinia()).use(router).mount('#app');
