// Ошибка в окне звонка не должна ронять весь чат: показываем сообщение и выходим из звонка.
import { Component, type ReactNode } from "react";
import { isStaleBuildError, reloadForNewBuild } from "../lib/staleBuild";
import { toast } from "../ui/Toaster";
import { leaveCall } from "./store";

export class CallBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (isStaleBuildError(error) && reloadForNewBuild()) return;
    toast("Не удалось открыть окно звонка. Обновите страницу и попробуйте ещё раз", "error");
    void leaveCall();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
