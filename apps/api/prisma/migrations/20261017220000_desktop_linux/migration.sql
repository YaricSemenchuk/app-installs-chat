-- Установщики для Ubuntu (.deb) рядом с macOS и Windows.
alter table desktop_installers drop constraint desktop_installers_platform_check;
alter table desktop_installers add constraint desktop_installers_platform_check check (platform in ('mac', 'win', 'linux'));
