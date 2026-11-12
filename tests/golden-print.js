// Prints the golden record (tests/golden.js): the hashes to save as golden-data.js, then the routes.
const rec = LM.golden.run();
document.getElementById('out').textContent = '/* The golden route hashes (tests/golden.js), taken before the routing moved into connect.js. */\n' +
  'LM.goldenData = ' + JSON.stringify(LM.golden.hashes(rec)) + ';\n\n' + JSON.stringify(rec, null, 1);
document.title = 'DONE';
