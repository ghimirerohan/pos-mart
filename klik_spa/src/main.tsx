import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import "./index.css";
import FrappeProviderWrapper from "./providers/FrappeProviderWrapper";
import { ensureCSRFToken, installFetchCSRFInterceptor } from "./utils/csrf";

ensureCSRFToken().then(() => {
  installFetchCSRFInterceptor();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FrappeProviderWrapper>
        <RouterProvider router={router} />
      </FrappeProviderWrapper>
    </React.StrictMode>
  );
});
