import type {
  CoreStore,
  PushedEvent,
  Stack,
  StackflowPlugin,
  StepPushedEvent,
} from "@stackflow/core";
import { makeCoreStore, makeEvent } from "@stackflow/core";
import type { Location, MemoryHistory } from "history";
import { createMemoryHistory } from "history";

import { historySyncPlugin } from "./historySyncPlugin";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// 2프레임 + 1프레임
const ENOUGH_DELAY_TIME = 32 + 16;

let dt = 0;

const enoughPastTime = () => {
  dt += 1;
  return new Date(Date.now() - MINUTE).getTime() + dt;
};

async function delay(ms: number) {
  return new Promise<void>((res) => {
    setTimeout(res, ms);
  });
}

const path = (location: Location) =>
  location.pathname + location.search + location.hash;

const stackflow = ({
  activityNames,
  plugins,
}: {
  activityNames: string[];
  plugins: StackflowPlugin[];
}) => {
  /**
   * `@stackflow/react`에서 복사됨
   */
  const pluginInstances = plugins.map((plugin) => plugin());
  const initialPushedEvents = pluginInstances.reduce<
    (PushedEvent | StepPushedEvent)[]
  >(
    (initialEvents, pluginInstance) =>
      pluginInstance.overrideInitialEvents?.({
        initialEvents,
        initialContext: {},
      }) ?? initialEvents,
    [],
  );

  const coreStore = makeCoreStore({
    initialEvents: [
      makeEvent("Initialized", {
        /**
         * 약 2프레임
         */
        transitionDuration: 32,
        eventDate: enoughPastTime(),
      }),
      ...activityNames.map((activityName) =>
        makeEvent("ActivityRegistered", {
          activityName,
          eventDate: enoughPastTime(),
        }),
      ),
      ...initialPushedEvents,
    ],
    plugins: [...plugins],
  });

  /**
   * 렌더링 시작
   */
  coreStore.init();

  return coreStore;
};

const activeActivity = (stack: Stack) =>
  stack.activities.find((a) => a.isActive);

describe("historySyncPlugin", () => {
  let history: MemoryHistory;
  let actions: CoreStore["actions"];

  /**
   * 매 테스트마다 history와 coreStore를 초기화합니다
   */
  beforeEach(() => {
    history = createMemoryHistory();

    const coreStore = stackflow({
      activityNames: ["Home", "Article", "ThirdActivity", "FourthActivity"],
      plugins: [
        historySyncPlugin({
          history,
          routes: {
            Home: "/home/",
            Article: "/articles/:articleId",
            ThirdActivity: "/third/:thirdId",
            FourthActivity: "/fourth/:fourthId",
          },
          fallbackActivity: () => "Home",
        }),
      ],
    });

    actions = coreStore.actions;
  });

  test("historySyncPlugin - 초기에 매칭하는 라우트가 없는 경우 fallbackActivity에 설정한 액티비티의 URL로 이동합니다", () => {
    expect(path(history.location)).toEqual("/home/");
  });

  test("historySyncPlugin - 초기에 매칭하는 라우트가 있는 경우 해당 액티비티의 URL로 이동합니다", () => {
    history = createMemoryHistory({
      initialEntries: ["/articles/123/?title=hello"],
    });

    const { actions } = stackflow({
      activityNames: ["Home", "Article"],
      plugins: [
        historySyncPlugin({
          history,
          routes: {
            Home: "/home",
            Article: "/articles/:articleId",
          },
          fallbackActivity: () => "Home",
        }),
      ],
    });

    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("123");
    expect(activeActivity(actions.getStack())?.params.title).toEqual("hello");
  });

  test("historySyncPlugin - actions.push() 후에, URL 상태가 알맞게 바뀝니다", () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1234",
        title: "hello",
      },
    });

    expect(path(history.location)).toEqual("/articles/1234/?title=hello");
  });

  test("historySyncPlugin - useHash: true이더라도, actions.push() 후에, URL 상태가 알맞게 바뀝니다", () => {
    history = createMemoryHistory();

    const coreStore = stackflow({
      activityNames: ["Home", "Article"],
      plugins: [
        historySyncPlugin({
          history,
          routes: {
            Home: "/home",
            Article: "/articles/:articleId",
          },
          fallbackActivity: () => "Home",
          useHash: true,
        }),
      ],
    });

    actions = coreStore.actions;

    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1234",
        title: "hello",
      },
    });

    expect(path(history.location)).toEqual("/#/articles/1234/?title=hello");
  });

  test("historySyncPlugin - actions.replace() 후에, URL 상태가 알맞게 바뀝니다", () => {
    actions.replace({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1234",
        title: "hello",
      },
    });

    expect(path(history.location)).toEqual("/articles/1234/?title=hello");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - actions.push(), actions.pop()을 여러번 하더라도, URL 상태가 알맞게 바뀝니다", () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/1/?title=hello");

    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "2",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/2/?title=hello");

    actions.push({
      activityId: "a3",
      activityName: "Article",
      activityParams: {
        articleId: "3",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/3/?title=hello");
    expect(history.index).toEqual(3);

    actions.pop();
    expect(path(history.location)).toEqual("/articles/2/?title=hello");
    expect(history.index).toEqual(2);

    actions.pop();
    expect(path(history.location)).toEqual("/articles/1/?title=hello");
    expect(history.index).toEqual(1);

    actions.pop();
    expect(path(history.location)).toEqual("/home/");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - 히스토리를 back하는 경우, 스택 상태가 알맞게 바뀝니다", () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1234",
        title: "hello",
      },
    });

    history.back();
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - 히스토리를 여러번 back하더라도, 스택 상태가 알맞게 바뀝니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "2",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a3",
      activityName: "Article",
      activityParams: {
        articleId: "3",
        title: "hello",
      },
    });

    history.back();
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
    expect(activeActivity(actions.getStack())?.params?.articleId).toEqual("2");

    history.back();
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
    expect(activeActivity(actions.getStack())?.params?.articleId).toEqual("1");

    history.back();
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - 앞으로 가기를 해도, 스택 상태가 알맞게 바뀝니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "1",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "2",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a3",
      activityName: "Article",
      activityParams: {
        articleId: "3",
        title: "hello",
      },
    });

    history.back();
    history.back();
    history.back();

    history.go(1);
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
    expect(activeActivity(actions.getStack())?.params?.articleId).toEqual("1");

    history.go(1);
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
    expect(activeActivity(actions.getStack())?.params?.articleId).toEqual("2");

    history.go(1);
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
    expect(activeActivity(actions.getStack())?.params?.articleId).toEqual("3");
  });

  test("historySyncPlugin - actions.stepPush()를 하면, 스택 상태가 알맞게 바뀌고, pop을 하면 한번에 여러 URL 상태가 사라집니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "10",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s1",
      stepParams: {
        articleId: "11",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/11/?title=hello");
    expect(history.index).toEqual(2);

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "12",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/12/?title=hello");
    expect(history.index).toEqual(3);

    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "20",
        title: "world",
      },
    });
    expect(path(history.location)).toEqual("/articles/20/?title=world");
    expect(history.index).toEqual(4);

    actions.pop();
    expect(path(history.location)).toEqual("/articles/12/?title=hello");
    expect(history.index).toEqual(3);

    actions.pop();
    expect(path(history.location)).toEqual("/home/");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - actions.stepPop()을 여러번 하더라도 남은 스텝이 없으면 아무일도 일어나지 않습니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "10",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s1",
      stepParams: {
        articleId: "11",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "12",
        title: "hello",
      },
    });

    actions.stepPop();
    actions.stepPop();

    actions.stepPop();
    expect(path(history.location)).toEqual("/articles/10/?title=hello");
    expect(history.index).toEqual(1);

    actions.stepPop();
    expect(path(history.location)).toEqual("/articles/10/?title=hello");
    expect(history.index).toEqual(1);

    actions.pop();
    expect(path(history.location)).toEqual("/home/");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - actions.stepReplace()를 하면, 스택 상태가 알맞게 바뀌고, pop을 하면 한번에 여러 URL 상태가 사라집니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "10",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s1",
      stepParams: {
        articleId: "11",
        title: "hello",
      },
    });

    actions.stepReplace({
      stepId: "s2",
      stepParams: {
        articleId: "12",
        title: "hello",
      },
    });
    expect(path(history.location)).toEqual("/articles/12/?title=hello");
    expect(history.index).toEqual(2);

    actions.stepPop();
    expect(path(history.location)).toEqual("/articles/10/?title=hello");
    expect(history.index).toEqual(1);

    actions.pop();
    expect(path(history.location)).toEqual("/home/");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - actions.stepPush()를 한 상태에서, 뒤로 가기, 앞으로 가기를 하면 스택 상태가 알맞게 바뀌고, pop을 하면 한번에 여러 URL 상태가 사라집니다", async () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "10",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s1",
      stepParams: {
        articleId: "11",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "12",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "20",
        title: "world",
      },
    });

    history.back();
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("12");

    history.back();
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("11");

    history.back();
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("10");

    history.go(1);
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("11");

    history.go(1);
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("12");

    history.go(1);
    expect(activeActivity(actions.getStack())?.params.articleId).toEqual("20");

    actions.pop();
    expect(path(history.location)).toEqual("/articles/12/?title=hello");

    actions.stepPop();
    expect(path(history.location)).toEqual("/articles/11/?title=hello");

    actions.pop();
    expect(path(history.location)).toEqual("/home/");
    expect(history.index).toEqual(0);
  });

  test("historySyncPlugin - 여러 행동 후에 새로고침을 하고 히스토리 조작을 하더라도, 스택 상태가 알맞게 바뀝니다", () => {
    actions.push({
      activityId: "a1",
      activityName: "Article",
      activityParams: {
        articleId: "10",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "20",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s1",
      stepParams: {
        articleId: "21",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "22",
        title: "hello",
      },
    });
    actions.stepReplace({
      stepId: "s3",
      stepParams: {
        articleId: "23",
        title: "hello",
      },
    });
    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "24",
        title: "hello",
      },
    });
    actions.push({
      activityId: "a3",
      activityName: "Article",
      activityParams: {
        articleId: "30",
        title: "hello",
      },
    });

    // 새로고침 후
    (() => {
      const { actions } = stackflow({
        activityNames: ["Home", "Article"],
        plugins: [
          historySyncPlugin({
            history,
            routes: {
              Home: "/home",
              Article: "/articles/:articleId",
            },
            fallbackActivity: () => "Home",
          }),
        ],
      });

      history.back();
      expect(activeActivity(actions.getStack())?.params.articleId).toEqual(
        "24",
      );
      expect(history.index).toEqual(5);

      history.back();
      expect(activeActivity(actions.getStack())?.params.articleId).toEqual(
        "23",
      );
      expect(history.index).toEqual(4);

      history.back();
      expect(activeActivity(actions.getStack())?.params.articleId).toEqual(
        "21",
      );
      expect(history.index).toEqual(3);

      history.back();
      expect(activeActivity(actions.getStack())?.params.articleId).toEqual(
        "20",
      );
      expect(history.index).toEqual(2);

      history.back();
      expect(activeActivity(actions.getStack())?.params.articleId).toEqual(
        "10",
      );
      expect(history.index).toEqual(1);

      history.back();
      expect(activeActivity(actions.getStack())?.name).toEqual("Home");
      expect(history.index).toEqual(0);
    })();
  });

  test("historySyncPlugin - push 후 stepPush 를 반복한 뒤, replace 를 하고 pop 을 수행하면 첫번째 stack 을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.replace({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });
    await delay(ENOUGH_DELAY_TIME);

    actions.pop();

    // 전환이 끝나기까지 충분한 시간
    // 코어쪽 추가된 테스트 코드가 Resolve 되면 삭제 가능
    await delay(32 + 16);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - push 후 *push 를 한 번 더 수행한 뒤*, stepPush 를 반복한 뒤, replace 를 하고 pop 을 수행하면 *두번째 stack* 을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });
    actions.push({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        thirdId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        thirdId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        thirdId: "4",
      },
    });

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "567",
      },
    });
    await delay(ENOUGH_DELAY_TIME);

    actions.pop();

    // 전환이 끝나기까지 충분한 시간
    // 코어쪽 추가된 테스트 코드가 Resolve 되면 삭제 가능
    await delay(32 + 16);

    expect(path(history.location)).toEqual("/articles/1/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Article");
  });

  test("historySyncPlugin - push 후 stepPush 를 반복한 뒤, push 와 pop 을 1회 수행하고 replace를 수행하고 pop 을 진행하면 첫번째 stack 을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.push({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });

    actions.pop();

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);

    actions.pop();

    // 전환이 끝나기까지 충분한 시간
    // 코어쪽 추가된 테스트 코드가 Resolve 되면 삭제 가능
    await delay(16 * 5);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - push 후 stepPush 를 반복한 뒤, replace 를 한 뒤 stepPush 를 반복하고 pop 을 진행해도 첫번째 stack 을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);

    actions.stepPush({
      stepId: "s5",
      stepParams: {
        fourthId: "5",
      },
    });

    actions.stepPush({
      stepId: "s6",
      stepParams: {
        fourthId: "6",
      },
    });

    actions.stepPush({
      stepId: "s7",
      stepParams: {
        fourthId: "7",
      },
    });

    actions.pop();

    // 전환이 끝나기까지 충분한 시간
    // 코어쪽 추가된 테스트 코드가 Resolve 되면 삭제 가능
    await delay(ENOUGH_DELAY_TIME);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - push 후 stepPush 를 반복한 뒤, replace 를 수행하고 stepPush 를 반복하고 replace를 수행하고 pop을 진행해도 첫번째 stack을 가리킵니다.(for Hugh)", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.replace({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });
    await delay(ENOUGH_DELAY_TIME);

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        thirdId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        thirdId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        thirdId: "4",
      },
    });

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);
    actions.pop();

    // 전환이 끝나기까지 충분한 시간
    // 코어쪽 추가된 테스트 코드가 Resolve 되면 삭제 가능
    await delay(ENOUGH_DELAY_TIME);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - push 후 stepPush 를 반복한 뒤, push 를 수행하고 stepPush 를 반복한 뒤 pop 을 수행, 그 후 replace 를 수행하고 pop을 진행해도 첫번째 stack을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.push({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        thirdId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        thirdId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        thirdId: "4",
      },
    });
    actions.pop();

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);
    actions.pop();

    await delay(ENOUGH_DELAY_TIME);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });

  test("historySyncPlugin - 2회 반복:push 후 stepPush 를 반복한 뒤, push 를 수행하고 stepPush 를 반복한 뒤 pop 을 수행, 그 후 replace 를 수행하고 pop을 진행해도 첫번째 stack을 가리킵니다.", async () => {
    actions.push({
      activityId: "a2",
      activityName: "Article",
      activityParams: {
        articleId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        articleId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        articleId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        articleId: "4",
      },
    });

    actions.push({
      activityId: "a3",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "234",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        thirdId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        thirdId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        thirdId: "4",
      },
    });
    actions.pop();

    actions.replace({
      activityId: "a4",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);
    actions.pop();

    await delay(ENOUGH_DELAY_TIME);
    actions.push({
      activityId: "a5",
      activityName: "ThirdActivity",
      activityParams: {
        thirdId: "1",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        thirdId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        thirdId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        thirdId: "4",
      },
    });

    actions.push({
      activityId: "a6",
      activityName: "FourthActivity",
      activityParams: {
        fourthId: "234",
      },
    });

    actions.stepPush({
      stepId: "s2",
      stepParams: {
        fourthId: "2",
      },
    });

    actions.stepPush({
      stepId: "s3",
      stepParams: {
        fourthId: "3",
      },
    });

    actions.stepPush({
      stepId: "s4",
      stepParams: {
        fourthId: "4",
      },
    });
    actions.pop();

    actions.replace({
      activityId: "a7",
      activityName: "Article",
      activityParams: {
        articleId: "345",
      },
    });
    await delay(ENOUGH_DELAY_TIME);
    actions.pop();

    await delay(ENOUGH_DELAY_TIME);

    expect(path(history.location)).toEqual("/home/");
    expect(activeActivity(actions.getStack())?.name).toEqual("Home");
  });
});
