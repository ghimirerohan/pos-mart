import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import "./index.css";
import FrappeProviderWrapper from "./providers/FrappeProviderWrapper";
import { ensureCSRFToken } from "./utils/csrf";

ensureCSRFToken().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FrappeProviderWrapper>
        <RouterProvider router={router} />
      </FrappeProviderWrapper>
    </React.StrictMode>
  );
});
