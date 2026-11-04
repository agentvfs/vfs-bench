请分析以下JavaScript代码的执行顺序，回答所有问题：

```javascript
const logs = [];
const log = (msg) => logs.push(msg);

const buffer = new Proxy(
  { val: 0 },
  {
    set(target, prop, value) {
      log(`B:Set:${value}`);
      target[prop] = value;
      return true;
    },
  }
);

const scheduler = {
  then: (resolve) => {
    log("Sched:Then");
    Promise.resolve().then(() => {
      log("Sched:Internal");
      queueMicrotask(() => {
        log("Sched:Resolve");
        resolve("Go");
      });
    });
  },
};

async function* streamProcessor(name) {
  log(`P:${name}:Start`);

  const signal = await scheduler;
  log(`P:${name}:Signal:${signal}`);

  let current = buffer.val;

  yield current;

  buffer.val = current + 10;
  log(`P:${name}:End`);
}

log("Global:Init");

const procA = streamProcessor("A");

const p1 = procA.next();

Promise.resolve()
  .then(() => {
    log("Inter:1");
    buffer.val = 50;
    return "Inter:Result";
  })
  .then((res) => {
    log(`Inter:2:${res}`);
  });

const procB = streamProcessor("B");
const p2 = procB.next();

log("Global:End");

// 最终输出由外部观测
setTimeout(() => console.log(logs), 0);
```

问题：
1. 写出完整的 logs 数组输出序列。
2. 在脚本执行的生命周期内，P:A:End 会不会被打印？解释原因。
3. 当 p1 完成 Resolve 后，内部 value 属性的精确值是多少？分析该值是否会受到 Inter:1 的影响。
4. 解释为什么 Inter:2:Inter:Result 会在第一个 Sched:Resolve 之前输出。

## Tools

This terminal is the task's `Bash` tool.
