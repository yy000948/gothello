### 本地对战
# 1. 启动后端（WebSocket）
cd server
npm install
npm start    

# 2. 启动前端（静态文件）
cd client
npm install -g serve
npx serve . --listen 3000

浏览器打开
http://localhost:3000?room=test
用两个标签页即可开始对弈。


### 跨网对战
后端部署在一台公网可达的机器（云服务器 / 支持公网 IP 的家宽 / 穿透隧道）。
前端把 Socket.IO 的连接地址改成这台公网机器的 IP 或域名 + 端口。

# 隧道模式
npm start
ngrok http 4000

显示Forwarding: https://abcd1234.ngrok.io -> http://localhost:4000

把 **https://abcd1234.ngrok.io**（实际生成的域名）替换进前端：
const socket = io('https://abcd1234.ngrok.io');

访问https://abcd1234.ngrok.io 即可跨网对战
