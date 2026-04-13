FROM oven/bun:1-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
