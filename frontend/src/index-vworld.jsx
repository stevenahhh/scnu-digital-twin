import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import AppVWorld from "./AppVWorld";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AppVWorld />
  </React.StrictMode>,
);
requestAnimationFrame(() => {
  document.getElementById("vworld-boot-status")?.remove();
});
