// Окно своего звонка: плавающая панель в углу, разворачивается на весь экран. Медиа ведёт LiveKit,
// плитки и кнопки — свои, на токенах дизайн-системы (стили LiveKit не подключаем).
import { useEffect, useState } from "react";
import { Headphones, Maximize2, Mic, MicOff, Minimize2, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff } from "lucide-react";
import { Track, type Participant } from "livekit-client";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  useTrackToggle,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { CALL_RING_SECONDS } from "@teamchat/shared";
import { userName, useBoot } from "../data/boot";
import { conversationTitle } from "../data/conversations";
import { cx } from "../lib/cx";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { toast } from "../ui/Toaster";
import { leaveCall, useCalls, type Session } from "./store";
import s from "./calls.module.scss";

const deviceName = (kind?: MediaDeviceKind) => (kind === "videoinput" ? "камере" : kind === "audioinput" ? "микрофону" : "устройству");
const deviceError = (kind?: MediaDeviceKind) => `Нет доступа к ${deviceName(kind)}. Разрешите его в настройках браузера или системы`;
// Нет доступа к камере или микрофону — это уже показал onMediaDeviceFailure, звонок при этом идёт.
const isDeviceError = (err: Error) =>
  ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError"].includes(err.name) ||
  /permission|getUserMedia|device/i.test(err.message);
// Ошибки LiveKit — технические и по-английски; человеку важно одно: не подключились.
const connectError = (err: Error) =>
  /signal connection|failed to fetch|network|websocket|timeout/i.test(err.message)
    ? "Не удалось подключиться к серверу звонков. Проверьте интернет и попробуйте ещё раз"
    : "Звонок прервался из-за ошибки. Попробуйте подключиться ещё раз";

export function CallWindow() {
  const session = useCalls((x) => x.session);
  if (!session) return null;
  return <CallRoom key={session.call.id} session={session} />;
}

function CallRoom({ session }: { session: Session }) {
  const boot = useBoot().data;
  const [expanded, setExpanded] = useState(false);
  const conv = boot?.conversations.find((c) => c.id === session.conversationId);
  const title = boot && conv ? conversationTitle(boot, conv) : "Звонок";
  const dm = conv?.kind === "dm" || conv?.kind === "group_dm";
  const alone = session.call.participantIds.length <= 1;
  const calling = dm && alone && session.call.startedBy === boot?.me.id;

  // Звоним в ЛС, а никто не взял трубку: кладём её сами.
  useEffect(() => {
    if (!calling) return;
    const t = setTimeout(() => {
      void leaveCall();
      toast(`${title}: не отвечает`);
    }, CALL_RING_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [calling, title]);

  return (
    <section className={cx(s.window, expanded && s.expanded)} aria-label={`Звонок: ${title}`}>
      <LiveKitRoom
        serverUrl={session.url}
        token={session.token}
        connect
        audio
        video={false}
        options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={() => void leaveCall()}
        onMediaDeviceFailure={(_failure, kind) => toast(deviceError(kind), "error")}
        onError={(err) => !isDeviceError(err) && toast(connectError(err), "error")}
        className={s.room}
      >
        <RoomAudioRenderer />
        <header className={s.head}>
          <Headphones aria-hidden />
          <span className={s.title}>{title}</span>
          <span className={s.muted}>{calling ? "Звоним…" : <Elapsed since={session.call.startedAt} />}</span>
        </header>
        <Stage />
        <Controls expanded={expanded} onExpand={() => setExpanded((v) => !v)} />
      </LiveKitRoom>
    </section>
  );
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <time aria-label="Длительность звонка">
      {mm}:{ss}
    </time>
  );
}

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const people = tracks.filter((t) => t.source === Track.Source.Camera);
  return (
    <div className={cx(s.stage, screen && s.withScreen)}>
      {screen && isTrackReference(screen) && (
        <figure className={s.screen}>
          <VideoTrack trackRef={screen} className={s.screenVideo} />
          <figcaption className={s.caption}>Экран: {nameOf(screen.participant)}</figcaption>
        </figure>
      )}
      <ul className={s.tiles} aria-label="Участники звонка">
        {people.map((t) => (
          <Tile key={t.participant.identity} trackRef={t} />
        ))}
      </ul>
    </div>
  );
}

function nameOf(p: Participant): string {
  return p.name || "Участник";
}

function Tile({ trackRef }: { trackRef: TrackReferenceOrPlaceholder }) {
  const boot = useBoot().data;
  const p = trackRef.participant;
  const speaking = useIsSpeaking(p);
  const camMuted = useIsMuted(trackRef);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone });
  const name = boot ? userName(boot, p.identity) : nameOf(p);
  const video = isTrackReference(trackRef) && !camMuted;
  return (
    <li className={cx(s.tile, speaking && s.speaking)} aria-label={`${name}${p.isLocal ? " (вы)" : ""}${micMuted ? ", микрофон выключен" : ""}`}>
      {video ? <VideoTrack trackRef={trackRef} className={s.video} /> : <Avatar name={name} id={p.identity} size="xl" decorative />}
      <span className={s.name}>
        {micMuted && <MicOff aria-hidden />}
        {name}
        {p.isLocal && " (вы)"}
      </span>
    </li>
  );
}

function Controls({ expanded, onExpand }: { expanded: boolean; onExpand: () => void }) {
  const onDeviceError = (err: Error) => toast(err.name === "NotAllowedError" ? deviceError() : err.message, "error");
  const mic = useTrackToggle({ source: Track.Source.Microphone, onDeviceError });
  const cam = useTrackToggle({ source: Track.Source.Camera, onDeviceError });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare, captureOptions: { audio: true, selfBrowserSurface: "exclude" }, onDeviceError });
  return (
    <div className={s.controls} role="toolbar" aria-label="Управление звонком">
      <IconButton label={mic.enabled ? "Выключить микрофон" : "Включить микрофон"} pressed={!mic.enabled} disabled={mic.pending} onClick={() => void mic.toggle()}>
        {mic.enabled ? <Mic /> : <MicOff />}
      </IconButton>
      <IconButton label={cam.enabled ? "Выключить камеру" : "Включить камеру"} pressed={cam.enabled} disabled={cam.pending} onClick={() => void cam.toggle()}>
        {cam.enabled ? <Video /> : <VideoOff />}
      </IconButton>
      <IconButton
        label={screen.enabled ? "Остановить показ экрана" : "Показать экран"}
        pressed={screen.enabled}
        disabled={screen.pending}
        onClick={() => void screen.toggle()}
      >
        {screen.enabled ? <ScreenShareOff /> : <ScreenShare />}
      </IconButton>
      <IconButton label={expanded ? "Свернуть" : "Развернуть"} onClick={onExpand}>
        {expanded ? <Minimize2 /> : <Maximize2 />}
      </IconButton>
      <Button variant="danger" size="s" icon={<PhoneOff />} onClick={() => void leaveCall()} className={s.leave}>
        Выйти
      </Button>
    </div>
  );
}
