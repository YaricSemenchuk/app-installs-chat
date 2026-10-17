-- M5: уровень уведомлений «ничего», звук вкл/выкл и PKCE для входа в десктоп-приложение через Google.

alter table user_preferences drop constraint user_preferences_notify_level_check;
alter table user_preferences add constraint user_preferences_notify_level_check
  check (notify_level in ('all', 'mentions', 'nothing'));
alter table user_preferences add constraint user_preferences_notification_sound_check
  check (notification_sound in ('default', 'none'));

-- Код из браузера обменивается на сессию только вместе с verifier, хэш которого (S256) пришёл
-- на /auth/google/start: перехваченный чужим приложением teamchat://-код без него бесполезен.
alter table auth_handoffs add column challenge text not null default '';
alter table auth_handoffs alter column challenge drop default;
