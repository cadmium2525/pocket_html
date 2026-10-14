importScripts('./classic-dependency.js');
self.onmessage = async () => {
  try {
    const response = await fetch('../data.json?worker=classic');
    const data = await response.json();
    self.postMessage({ value: data.value + self.classicValue });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
