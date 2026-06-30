fetch('http://localhost:3000/api/parse-cv', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pdfBase64: Buffer.from('dummy pdf content').toString('base64'),
    mimeType: 'application/pdf'
  })
}).then(r => r.json()).then(console.log).catch(console.error);
