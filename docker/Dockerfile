# Calends 自托管镜像：Worker 跑在 workerd（经 wrangler 的本地模式），数据是 /data 下的 SQLite 文件。
# 构建（在仓库根目录执行）：docker build -f docker/Dockerfile -t calends .
# 运行：docker run -d -p 8787:8787 -v calends-data:/data calends
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG BASE_PATH=""
RUN rm -rf local && BASE_PATH="$BASE_PATH" npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    WRANGLER_SEND_METRICS=false \
    CI=true \
    PORT=8787 \
    DATA_DIR=/data
# workerd 访问外网（汇率、提醒推送）需要系统 CA 证书
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
# 运行时只需要 wrangler（含 workerd）和 Worker 自己的依赖，前端已在构建阶段打包好
COPY --from=build /app/package.json ./package.full.json
RUN node -e "const p=require('./package.full.json');const all={...p.dependencies,...p.devDependencies};const pick=['wrangler','@simplewebauthn/server'];require('fs').writeFileSync('package.json',JSON.stringify({name:'calends-runtime',private:true,type:'module',dependencies:Object.fromEntries(pick.map(k=>[k,all[k]]))},null,2))" \
  && rm package.full.json \
  && npm install --no-audit --no-fund \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/worker ./worker
COPY --from=build /app/shared ./shared
COPY --from=build /app/tsconfig.json ./
COPY docker/wrangler.docker.jsonc ./wrangler.jsonc
COPY docker/entrypoint.mjs ./docker/entrypoint.mjs
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "docker/entrypoint.mjs"]
