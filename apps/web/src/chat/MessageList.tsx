// Лента разговора: подгрузка истории вверх с сохранением позиции, прилипание к низу,
// разделители дней и «Новые». Виртуализация (react-virtuoso) — когда лента станет тяжёлой.
import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { BootDto } from "@teamchat/shared";
import { useMessages } from "../data/messages";
import { dayKey, dayLabel } from "../lib/format";
import { EmptyState, Skeleton } from "../ui/Feedback";
import { Spinner } from "../ui/Spinner";
import { DateDivider, UnreadDivider } from "./Message";
import { MessageRow } from "./MessageRow";
import s from "./MessageList.module.scss";

const NEAR_BOTTOM_PX = 80;

type Props = {
  conversationId: string;
  title: string;
  boot: BootDto;
  unreadAfterSeq: number; // курсор на момент открытия: всё после него помечается «Новые»
  onAtBottomChange: (atBottom: boolean) => void;
  intro: { icon: ReactNode; title: string; text: string };
  focusId?: string | null; // переход по ссылке: прокрутить к сообщению вместо низа
};

export function MessageList({ conversationId, title, boot, unreadAfterSeq, onAtBottomChange, intro, focusId }: Props) {
  const feed = useMessages((st) => st.feeds[conversationId]);
  const loadBefore = useMessages((st) => st.loadBefore);
  const scroller = useRef<HTMLDivElement>(null);
  const topSentinel = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const initialScrollDone = useRef(false);
  const prevFirstId = useRef<string | undefined>(undefined);
  const prevHeight = useRef(0);
  const focusedId = useRef<string | null>(null);

  const items = feed?.items ?? [];
  const meId = boot.me.id;
  const firstUnread = items.find((m) => !m.local && !m.deleted && m.seq > unreadAfterSeq && m.userId !== meId && m.subtype === null);

  // Позиция: при первом показе — к «Новые» или вниз; при подгрузке истории — держим то, что видел человек;
  // при новых сообщениях — вниз, если он и так был внизу.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !feed?.loaded) return;
    const firstId = items[0]?.id;
    const focus = focusId ? el.querySelector<HTMLElement>(`[data-id="${focusId}"]`) : null;
    if (focus && focusedId.current !== focusId) {
      focus.scrollIntoView({ block: "center" });
      focusedId.current = focusId ?? null;
      initialScrollDone.current = true;
    } else if (!initialScrollDone.current) {
      const divider = el.querySelector<HTMLElement>("[data-unread-divider]");
      if (divider) el.scrollTop = Math.max(0, divider.offsetTop - el.clientHeight / 3);
      else el.scrollTop = el.scrollHeight;
      initialScrollDone.current = true;
    } else if (prevFirstId.current && firstId !== prevFirstId.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirstId.current = firstId;
    prevHeight.current = el.scrollHeight;
  }, [items, feed?.loaded, focusId]);

  // Верхняя граница видна — грузим историю.
  useEffect(() => {
    const el = topSentinel.current;
    if (!el || !scroller.current) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && initialScrollDone.current) void loadBefore(conversationId);
      },
      { root: scroller.current, rootMargin: "400px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [conversationId, loadBefore, feed?.loaded]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (bottom !== atBottom.current) {
      atBottom.current = bottom;
      onAtBottomChange(bottom);
    }
  }

  if (feed?.error && !feed.loaded) {
    return (
      <div className={s.center} role="alert">
        <p className={s.error}>{feed.error}</p>
      </div>
    );
  }
  if (!feed?.loaded) {
    return (
      <div className={s.scroller} aria-busy="true" aria-label="Загрузка сообщений">
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.skeletonRow}>
            <Skeleton width={36} height={36} round />
            <span className={s.skeletonLines}>
              <Skeleton width={140} height={12} />
              <Skeleton width={i === 1 ? 220 : 380} height={12} />
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={scroller} className={s.scroller} onScroll={onScroll} role="log" aria-label={`Сообщения: ${title}`} aria-live="polite">
      <div ref={topSentinel} />
      {feed.loadingBefore && (
        <div className={s.loadingTop}>
          <Spinner />
        </div>
      )}
      {!feed.hasMoreBefore && (
        <EmptyState icon={intro.icon} title={intro.title} text={intro.text} />
      )}
      {items.map((m, i) => {
        const prev = items[i - 1];
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        return (
          <Fragment key={m.clientMsgId ?? m.id}>
            {newDay && <DateDivider label={dayLabel(m.createdAt)} />}
            {m === firstUnread && <UnreadMarker />}
            <MessageRow message={m} prev={newDay || m === firstUnread ? undefined : prev} place="feed" />
          </Fragment>
        );
      })}
    </div>
  );
}

function UnreadMarker() {
  return (
    <div data-unread-divider>
      <UnreadDivider />
    </div>
  );
}
