import { useActivity, useStack, useStackActions } from "@stackflow/react";
import { assignInlineVars } from "@vanilla-extract/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";

import * as css from "./AppBar.css";
import * as appScreenCss from "./AppScreen.css";
import { IconBack, IconClose } from "./assets";
import { last, noop, onResize } from "./utils";

interface AppBarProps {
  theme: "android" | "cupertino";
  title?: React.ReactNode;
  appendLeft?: () => React.ReactNode;
  appendRight?: () => React.ReactNode;
  closeButtonLocation?: "left" | "right";
  customBackButton?: () => React.ReactNode;
  customCloseButton?: () => React.ReactNode;
  onClose?: () => void;
  border?: boolean;
}
const AppBar: React.FC<AppBarProps> = ({
  theme,
  title,
  appendLeft,
  appendRight,
  closeButtonLocation = "left",
  customBackButton,
  customCloseButton,
  onClose,
  border = true,
}) => {
  const stack = useStack();
  const currentActivity = useActivity();
  const stackActions = useStackActions();

  const visibleActivities = useMemo(
    () =>
      stack.activities.filter(
        (activity) =>
          activity.transitionState === "enter-active" ||
          activity.transitionState === "enter-done" ||
          activity.transitionState === "exit-active",
      ),
    [stack.activities],
  );
  const activeActivities = useMemo(
    () =>
      visibleActivities.filter(
        (activity) =>
          activity.transitionState === "enter-active" ||
          activity.transitionState === "enter-done",
      ),
    [visibleActivities],
  );

  const isActiveTop = useMemo(
    () => last(activeActivities)?.id === currentActivity.id,
    [activeActivities, currentActivity],
  );
  const isVisibleTop = useMemo(
    () => last(visibleActivities)?.id === currentActivity.id,
    [visibleActivities, currentActivity],
  );

  const isRoot = activeActivities[0]?.id === currentActivity.id;

  const appBarRef = useRef<HTMLDivElement>(null);
  const appBarCenterRef = useRef<HTMLDivElement>(null);

  const [centerMainWidth, setCenterMainWidth] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    const $appBar = appBarRef.current;
    const $appBarCenter = appBarCenterRef.current;

    if (theme !== "cupertino" || !$appBar || !$appBarCenter) {
      return noop;
    }

    const dispose = onResize(() => {
      const screenWidth = $appBar.clientWidth;

      const leftWidth = $appBarCenter.offsetLeft;
      const centerWidth = $appBarCenter.clientWidth;
      const rightWidth = screenWidth - leftWidth - centerWidth;

      const sideMargin = Math.max(leftWidth, rightWidth);

      setCenterMainWidth(screenWidth - 2 * sideMargin);
    });

    return dispose;
  }, []);

  const onBack = () => {
    stackActions.pop();
  };

  const backButton = !isRoot && (
    <button type="button" className={css.backButton} onClick={onBack}>
      {customBackButton ? customBackButton() : <IconBack />}
    </button>
  );

  const closeButton = onClose && isRoot && (
    <button type="button" className={css.closeButton} onClick={onClose}>
      {customCloseButton ? customCloseButton() : <IconClose />}
    </button>
  );

  const hasLeft = !!(
    (closeButtonLocation === "left" && closeButton) ||
    backButton ||
    appendLeft
  );

  return (
    <div
      ref={appBarRef}
      className={css.appBar({
        border,
        isActiveTop,
        isVisibleTop,
      })}
      style={assignInlineVars({
        [appScreenCss.vars.appBar.center.mainWidth]: `${centerMainWidth}px`,
      })}
    >
      <div className={css.left}>
        {closeButtonLocation === "left" && closeButton}
        {backButton}
        {appendLeft?.()}
      </div>
      <div ref={appBarCenterRef} className={css.center}>
        <div
          className={css.centerShrinked({
            theme,
            hasLeft,
          })}
        >
          {typeof title === "string" ? (
            <div className={css.centerText}>{title}</div>
          ) : (
            title
          )}
        </div>
      </div>
      <div className={css.right}>
        {appendRight?.()}
        {closeButtonLocation === "right" && closeButton}
      </div>
    </div>
  );
};

export default AppBar;
