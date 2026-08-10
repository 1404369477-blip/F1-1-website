const command = process.env.npm_lifecycle_event ?? "c-layer-command";

console.error(
  `${command}: C 层仍 pending；B 层脚手架不会访问真实 provider、Base、平台或外部网络。`
);
process.exitCode = 1;
