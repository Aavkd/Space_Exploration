import { App } from './app/App.js';

const canvas = document.querySelector('#app-canvas');
const app = new App({ canvas });

app.start();
