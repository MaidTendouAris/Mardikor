import React from "react";
import { createRoot } from "react-dom/client";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { t, resolveAppLocale, setAppLocale } from "../shared/i18n";
import "./styles/base.css";

class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="startup-error">
        <h1>{t("工作区加载失败")}</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>{t("重新加载")}</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const locale = window.mardikor
  ? await window.mardikor.locale().catch(() => "en" as const)
  : resolveAppLocale("system", navigator.language);
setAppLocale(locale);
document.documentElement.lang = locale;

const { default: App } = await import("./App");
createRoot(document.getElementById("app")!).render(
  <ErrorBoundary>
    <DndProvider backend={HTML5Backend}>
      <App />
    </DndProvider>
  </ErrorBoundary>,
);
