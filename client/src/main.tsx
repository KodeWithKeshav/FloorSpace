import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import App from "./App";
import PhoneApp from "./phone/PhoneApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith("/phone") ? <PhoneApp /> : <App />}
  </React.StrictMode>,
);
