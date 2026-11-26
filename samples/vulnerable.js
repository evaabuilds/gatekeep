// Intentionally INSECURE example code for testing GateKeep. Do not use in real projects.
const express = require("express");
const { exec } = require("child_process");
const app = express();

const JWT_SECRET = "supersecret123"; // hardcoded secret

app.get("/greet", (req, res) => {
  // XSS: user input written straight into HTML
  res.send("<h1>Hello " + req.query.name + "</h1>");
});

app.get("/run", (req, res) => {
  // Command injection
  exec("ls " + req.query.dir, (err, out) => res.send(out));
});

app.get("/calc", (req, res) => {
  // Arbitrary code execution
  res.send(String(eval(req.query.expr)));
});

app.get("/admin", (req, res) => {
  // Logic bug (Semgrep can't see this): "admin" check trusts a query parameter
  if (req.query.isAdmin === "true") {
    res.send("Welcome, admin");
  }
});

app.listen(3000);
