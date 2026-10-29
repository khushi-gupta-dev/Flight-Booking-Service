FROM node 

WORKDIR /desktop/nodejs/flight-booking


COPY . .

RUN npm ci

CMD ["npm", "run", "dev"]

