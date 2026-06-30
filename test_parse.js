async function test() {
  const res = await fetch('http://127.0.0.1:3000/api/test-ai');
  const text = await res.text();
  console.log("STATUS:", res.status);
  console.log("BODY:", text.substring(0, 100));
}
test();
