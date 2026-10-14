window.report = (label, value) => {
  const li = document.createElement('li');
  li.textContent = `${label}: ${value}`;
  document.querySelector('#results').append(li);
};
report('Classic script', 'PASS');
