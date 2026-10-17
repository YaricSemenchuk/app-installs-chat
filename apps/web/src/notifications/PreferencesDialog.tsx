// S34 — настройки (пока раздел «Уведомления»). Каждое изменение сохраняется сразу и расходится по устройствам.
import { useState } from "react";
import type { NotifyLevel, PreferencesDto } from "@teamchat/shared";
import { api } from "../api/http";
import { getBoot, updateBoot, useBoot } from "../data/boot";
import { desktop } from "../desktop/bridge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { RadioGroup } from "../ui/RadioGroup";
import { Switch } from "../ui/Toggle";
import { toast } from "../ui/Toaster";
import { askPermission, browserPermission, show, type Permission } from "./notify";
import s from "./notifications.module.scss";

export async function savePreferences(patch: Partial<PreferencesDto>) {
  const before = getBoot()?.preferences;
  updateBoot((b) => ({ ...b, preferences: { ...b.preferences, ...patch } }));
  try {
    const saved = await api<PreferencesDto>("/me/preferences", { method: "PATCH", body: patch });
    updateBoot((b) => ({ ...b, preferences: saved }));
  } catch (err) {
    if (before) updateBoot((b) => ({ ...b, preferences: before }));
    toast((err as Error).message, "error");
  }
}

const permissionText: Record<Permission, string> = {
  granted: "На этом компьютере уведомления разрешены.",
  default: "Браузер ещё не спрашивал разрешения на уведомления.",
  denied: "Браузер запретил уведомления для этого сайта. Разрешите их в настройках сайта (значок слева от адреса).",
  unsupported: "Этот браузер не умеет показывать уведомления.",
};

export function PreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const prefs = useBoot().data?.preferences;
  const [permission, setPermission] = useState<Permission>(browserPermission());
  if (!prefs) return null;
  const off = prefs.notifyLevel === "nothing" || !prefs.desktopNotifications;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Настройки" size="m">
      <section className={s.section} aria-labelledby="prefs-notify">
        <h3 id="prefs-notify" className={s.heading}>
          Уведомления
        </h3>
        <RadioGroup<NotifyLevel>
          label="Когда уведомлять"
          value={prefs.notifyLevel}
          onValueChange={(v) => void savePreferences({ notifyLevel: v })}
          options={[
            { value: "mentions", label: "Личные сообщения, упоминания и треды", hint: "Подходит почти всем: зовут — узнаете сразу" },
            { value: "all", label: "Все новые сообщения", hint: "Во всех каналах, где вы состоите" },
            { value: "nothing", label: "Ничего", hint: "Счётчики в списке слева останутся" },
          ]}
        />
        <div className={s.switches}>
          <Switch
            label="Показывать уведомления"
            hint={desktop ? "Системные уведомления приложения" : "Всплывают, когда вкладка не на экране"}
            checked={prefs.desktopNotifications}
            onCheckedChange={(v) => void savePreferences({ desktopNotifications: v })}
          />
          <Switch
            label="Ответы в тредах, за которыми я слежу"
            hint="Слежение включается само, когда вы пишете в тред или вас там упоминают"
            checked={prefs.notifyThreadReplies}
            disabled={off}
            onCheckedChange={(v) => void savePreferences({ notifyThreadReplies: v })}
          />
          <Switch
            label="Текст сообщения в уведомлении"
            hint="Выключите, если экран видят другие"
            checked={prefs.showMessagePreview}
            disabled={off}
            onCheckedChange={(v) => void savePreferences({ showMessagePreview: v })}
          />
          <Switch label="Звук" checked={prefs.sound} disabled={off} onCheckedChange={(v) => void savePreferences({ sound: v })} />
        </div>

        {!desktop && (
          <div className={s.permission}>
            <p>{permissionText[permission]}</p>
            {permission === "default" && (
              <Button size="s" variant="secondary" onClick={() => void askPermission().then(setPermission)}>
                Разрешить уведомления
              </Button>
            )}
          </div>
        )}
        <div className={s.test}>
          <Button
            size="s"
            variant="ghost"
            disabled={off || permission === "denied" || permission === "unsupported"}
            onClick={() => show("Проверка уведомлений", "Если вы это видите, всё работает", window.location.pathname, prefs.sound)}
          >
            Прислать пробное уведомление
          </Button>
        </div>
      </section>
    </Dialog>
  );
}
