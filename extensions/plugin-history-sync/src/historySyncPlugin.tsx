import { id, makeEvent } from "@stackflow/core";
import type { StackflowReactPlugin } from "@stackflow/react";
import type { History, Listener } from "history";
import { createBrowserHistory, createMemoryHistory } from "history";

import {
  getCurrentState,
  pushState,
  replaceState,
  safeParseState,
} from "./historyState";
import { last } from "./last";
import type { UrlPatternOptions } from "./makeTemplate";
import { makeTemplate } from "./makeTemplate";
import { normalizeRoute } from "./normalizeRoute";
import { makeQueue } from "./queue";
import { RoutesProvider } from "./RoutesContext";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

type HistorySyncPluginOptions<K extends string> = {
  routes: {
    [key in K]: string | string[];
  };
  fallbackActivity: (args: { initialContext: any }) => K;
  useHash?: boolean;
  history?: History;
  urlPatternOptions?: UrlPatternOptions;
};
export function historySyncPlugin<
  T extends { [activityName: string]: unknown },
>(
  options: HistorySyncPluginOptions<Extract<keyof T, string>>,
): StackflowReactPlugin {
  type K = Extract<keyof T, string>;

  const history =
    options.history ??
    (typeof window === "undefined"
      ? createMemoryHistory({})
      : createBrowserHistory({
          window,
        }));

  const { location } = history;

  return () => {
    let pushFlag = 0;
    let popFlag = 0;
    let replacePopCount = 0;

    const queue = makeQueue(history);

    return {
      key: "plugin-history-sync",
      wrapStack({ stack }) {
        return (
          <RoutesProvider routes={options.routes}>
            {stack.render()}
          </RoutesProvider>
        );
      },
      overrideInitialEvents({ initialContext }) {
        const initialHistoryState = safeParseState(
          getCurrentState({ history }),
        );

        if (initialHistoryState) {
          return [
            {
              ...initialHistoryState.activity.enteredBy,
              name: "Pushed",
            },
            ...(initialHistoryState.step?.enteredBy.name === "StepPushed" ||
            initialHistoryState.step?.enteredBy.name === "StepReplaced"
              ? [
                  {
                    ...initialHistoryState.step.enteredBy,
                    name: "StepPushed" as const,
                  },
                ]
              : []),
          ];
        }

        function resolvePath() {
          if (
            initialContext?.req?.path &&
            typeof initialContext.req.path === "string"
          ) {
            return initialContext.req.path as string;
          }

          if (options.useHash) {
            return location.hash.split("#")[1] ?? "/";
          }

          return location.pathname + location.search;
        }

        const path = resolvePath();
        const activityNames = Object.keys(options.routes);

        if (path) {
          for (const activityName of activityNames) {
            const routes = normalizeRoute(options.routes[activityName as K]);

            for (const route of routes) {
              const template = makeTemplate(route, options.urlPatternOptions);
              const activityParams = template.parse(path);

              if (activityParams) {
                const activityId = id();

                return [
                  makeEvent("Pushed", {
                    activityId,
                    activityName,
                    activityParams: {
                      ...activityParams,
                    },
                    eventDate: new Date().getTime() - MINUTE,
                    activityContext: {
                      path,
                    },
                  }),
                ];
              }
            }
          }
        }

        const fallbackActivityId = id();
        const fallbackActivityName = options.fallbackActivity({
          initialContext,
        });
        const fallbackActivityRoutes = normalizeRoute(
          options.routes[fallbackActivityName],
        );
        const fallbackActivityPath = fallbackActivityRoutes[0];

        return [
          makeEvent("Pushed", {
            activityId: fallbackActivityId,
            activityName: fallbackActivityName,
            activityParams: {},
            eventDate: new Date().getTime() - MINUTE,
            activityContext: {
              path: fallbackActivityPath,
            },
          }),
        ];
      },
      onInit({ actions: { getStack, dispatchEvent, push, stepPush } }) {
        const rootActivity = getStack().activities[0];

        const template = makeTemplate(
          normalizeRoute(options.routes[rootActivity.name])[0],
          options.urlPatternOptions,
        );

        const lastStep = last(rootActivity.steps);

        queue(() =>
          replaceState({
            history,
            pathname: template.fill(rootActivity.params),
            state: {
              activity: rootActivity,
              step: lastStep,
            },
            useHash: options.useHash,
          }),
        );

        const onPopState: Listener = (e) => {
          if (popFlag) {
            popFlag -= 1;
            return;
          }

          const historyState = safeParseState(e.location.state);

          if (!historyState) {
            return;
          }

          const targetActivity = historyState.activity;
          const targetActivityId = historyState.activity.id;
          const targetStep = historyState.step;

          const { activities } = getStack();
          const currentActivity = activities.find(
            (activity) => activity.isActive,
          );

          if (!currentActivity) {
            return;
          }

          const currentStep = last(currentActivity.steps);

          const nextActivity = activities.find(
            (activity) => activity.id === targetActivityId,
          );
          const nextStep = currentActivity.steps.find(
            (step) => step.id === targetStep?.id,
          );

          const isBackward = () => currentActivity.id > targetActivityId;
          const isForward = () => currentActivity.id < targetActivityId;
          const isStep = () => currentActivity.id === targetActivityId;

          const isStepBackward = () => {
            if (!isStep()) {
              return false;
            }

            if (!targetStep) {
              return true;
            }
            if (currentStep && currentStep.id > targetStep.id) {
              return true;
            }

            return false;
          };
          const isStepForward = () => {
            if (!isStep()) {
              return false;
            }

            if (!currentStep) {
              return true;
            }
            if (targetStep && currentStep.id < targetStep.id) {
              return true;
            }

            return false;
          };

          if (isBackward()) {
            dispatchEvent("Popped", {});

            if (!nextActivity) {
              pushFlag += 1;
              push({
                ...targetActivity.enteredBy,
              });

              if (
                targetStep?.enteredBy.name === "StepPushed" ||
                targetStep?.enteredBy.name === "StepReplaced"
              ) {
                pushFlag += 1;
                stepPush({
                  ...targetStep.enteredBy,
                });
              }
            }
          }
          if (isStepBackward()) {
            if (
              !nextStep &&
              targetStep &&
              (targetStep?.enteredBy.name === "StepPushed" ||
                targetStep?.enteredBy.name === "StepReplaced")
            ) {
              pushFlag += 1;
              stepPush({
                ...targetStep.enteredBy,
              });
            }

            dispatchEvent("StepPopped", {});
          }

          if (isForward()) {
            pushFlag += 1;
            push({
              activityId: targetActivity.id,
              activityName: targetActivity.name,
              activityParams: targetActivity.params,
            });
          }
          if (isStepForward()) {
            if (!targetStep) {
              return;
            }

            pushFlag += 1;
            stepPush({
              stepId: targetStep.id,
              stepParams: targetStep.params,
            });
          }
        };

        history.listen(onPopState);
      },
      onPushed({ effect: { activity } }) {
        if (pushFlag) {
          pushFlag -= 1;
          return;
        }

        const template = makeTemplate(
          normalizeRoute(options.routes[activity.name])[0],
          options.urlPatternOptions,
        );

        queue(() =>
          pushState({
            history,
            pathname: template.fill(activity.params),
            state: {
              activity,
            },
            useHash: options.useHash,
          }),
        );
      },
      onStepPushed({ effect: { activity, step } }) {
        if (pushFlag) {
          pushFlag -= 1;
          return;
        }

        const template = makeTemplate(
          normalizeRoute(options.routes[activity.name])[0],
          options.urlPatternOptions,
        );

        queue(() =>
          pushState({
            history,
            pathname: template.fill(activity.params),
            state: {
              activity,
              step,
            },
            useHash: options.useHash,
          }),
        );
      },
      onReplaced({ effect: { activity } }) {
        if (!activity.isActive) {
          return;
        }

        const template = makeTemplate(
          normalizeRoute(options.routes[activity.name])[0],
          options.urlPatternOptions,
        );

        queue(() =>
          replaceState({
            history,
            pathname: template.fill(activity.params),
            state: {
              activity,
            },
            useHash: options.useHash,
          }),
        );
      },
      onStepReplaced({ effect: { activity, step } }) {
        if (!activity.isActive) {
          return;
        }

        const template = makeTemplate(
          normalizeRoute(options.routes[activity.name])[0],
          options.urlPatternOptions,
        );

        queue(() =>
          replaceState({
            history,
            pathname: template.fill(activity.params),
            state: {
              activity,
              step,
            },
            useHash: options.useHash,
          }),
        );
      },
      onBeforePush({ actionParams, actions: { overrideActionParams } }) {
        const template = makeTemplate(
          normalizeRoute(options.routes[actionParams.activityName])[0],
          options.urlPatternOptions,
        );
        const path = template.fill(actionParams.activityParams);

        overrideActionParams({
          ...actionParams,
          activityContext: {
            ...actionParams.activityContext,
            path,
          },
        });
      },
      onBeforeReplace({
        actionParams,
        actions: { overrideActionParams, getStack },
      }) {
        const template = makeTemplate(
          normalizeRoute(options.routes[actionParams.activityName])[0],
          options.urlPatternOptions,
        );
        const path = template.fill(actionParams.activityParams);

        overrideActionParams({
          ...actionParams,
          activityContext: {
            ...actionParams.activityContext,
            path,
          },
        });

        const { activities } = getStack();
        const enteredActivities = activities.filter(
          (currentActivity) =>
            currentActivity.transitionState === "enter-active" ||
            currentActivity.transitionState === "enter-done",
        );
        const previousActivity =
          enteredActivities.length > 0
            ? enteredActivities[enteredActivities.length - 1]
            : null;
        const popCount = previousActivity?.steps.length
          ? previousActivity.steps.length
          : 0;

        replacePopCount += popCount;
      },
      onBeforeStepPop({ actions: { getStack } }) {
        const { activities } = getStack();
        const currentActivity = activities.find(
          (activity) => activity.isActive,
        );

        if ((currentActivity?.steps.length ?? 0) > 1) {
          popFlag += 1;
          queue(history.back);
        }
      },
      onBeforePop({ actions: { getStack } }) {
        const { activities } = getStack();
        const currentActivity = activities.find(
          (activity) => activity.isActive,
        );
        const enteredActivities = activities.filter(
          (activity) =>
            activity.transitionState === "enter-active" ||
            activity.transitionState === "enter-done",
        );
        const currentActivityIndex = enteredActivities.findIndex(
          (activity) => activity.isActive,
        );
        const previousActivity =
          currentActivityIndex && currentActivityIndex > 0
            ? enteredActivities[currentActivityIndex - 1]
            : null;

        const currentStepsLength = currentActivity?.steps.length ?? 0;

        let popCount = currentStepsLength;

        if (
          currentActivity?.enteredBy.name === "Replaced" &&
          previousActivity
        ) {
          // replace 이후에 stepPush 만 진행하고 pop 을 수행하는 경우
          const shouldPopForCurrentStepPush = currentStepsLength > 1;
          popCount = shouldPopForCurrentStepPush
            ? replacePopCount + currentStepsLength
            : replacePopCount;
        }
        popFlag += popCount;

        do {
          for (let i = 0; i < popCount; i += 1) {
            queue(history.back);
          }

          if (
            currentActivity?.enteredBy.name === "Replaced" &&
            previousActivity &&
            replacePopCount > 0
          ) {
            replacePopCount = 0;
          }
        } while (!safeParseState(getCurrentState({ history })));
      },
    };
  };
}
