FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Expose the port Express uses
EXPOSE 3000

# Run server
CMD ["node", "server.js"]
