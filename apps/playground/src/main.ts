import { VERSION } from "javascript-excel";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  const title = document.createElement("h1");
  title.textContent = "javascript-excel 2.0 playground — in progress";
  const version = document.createElement("p");
  version.textContent = `Package version: ${VERSION}`;
  app.append(title, version);
}
