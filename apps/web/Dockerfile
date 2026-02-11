# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Build arg for API URL (REQUIRED at build time)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Fail fast if API URL not provided
RUN if [ -z "$VITE_API_URL" ]; then echo "ERROR: VITE_API_URL build arg is required" && exit 1; fi

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build for production (VITE_API_URL is baked in here)
RUN npm run build

# Production stage - serve with nginx
FROM nginx:alpine AS runner

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Remove default nginx config and copy our template
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/nginx.conf.template

# Render sets PORT; default to 80 for local Docker
ENV PORT=80

# Substitute only $PORT (not $uri), then start nginx
CMD ["/bin/sh", "-c", "envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
