-- Установщики для Arch Linux (пакет pacman) рядом с macOS, Windows и Ubuntu.
alter table desktop_installers drop constraint desktop_installers_platform_check;
alter table desktop_installers add constraint desktop_installers_platform_check check (platform in ('mac', 'win', 'linux', 'arch'));
