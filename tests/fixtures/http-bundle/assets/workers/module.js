import { moduleValue } from './module-dependency.js';
self.onmessage = async () => {
  try {
    const chunkName = ['module', 'dynamic'].join('-');
    const chunk = await import('./' + chunkName + '.js');
    const response = await fetch(new URL('../data.json?worker=module', import.meta.url));
    const data = await response.json();
    self.postMessage({ value: data.value + moduleValue + chunk.value });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
