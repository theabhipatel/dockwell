# DockWell web app: the pre-rendered public site and the app shell, served by nginx, which also
# proxies /api and /v1 to the API container (see nginx.conf).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SITE_URL=""
ARG VITE_DEMO_MODE="false"
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
