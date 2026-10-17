import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import ShopPage from "./components/ShopPage.jsx";
import OwnerDashboard from "./components/OwnerDashboard.jsx";

const isOwner = window.location.pathname.startsWith("/owner");
createRoot(document.getElementById("root")).render(
  <React.StrictMode>{isOwner ? <OwnerDashboard /> : <ShopPage />}</React.StrictMode>,
);
