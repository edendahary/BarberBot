FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Set timezone to Israel
ENV TZ=Asia/Jerusalem

# Start the bot
CMD ["npm", "start"]
