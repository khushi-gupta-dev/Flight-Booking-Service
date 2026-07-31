This is a base node js project template , which anyone can use as it has been prepared , by keeping some of the most important code principles and project management recommendation. Feel free to change anything. 


`src` -> Inside the src folder all the actual source code regarding the project will reside , this will not include  any kind of tests .(You moght want to make seperate tests folder)

Lets take a look inside the  `src` folder

-`config`-> In this folder anything and everything regarding any configuration or setup of a library or module will be done. For example: setting up `dotenv` so that we can use the environment variables anywhere in a cleaner fashion, this is done in the `server-config.js` . One more example can be to setup your logging library that can help you to prepare meaningful logs, so configuration for this library should also be done here . 

-`routes`-> In the routes folder , we register a route and the corresponding middleware and controllers to it . 

-`middlewares`-> They are just going to interpret the incoming requests where we can write our validators, authenticators etc. 

-`controllers`-> They are kind of the last middlewares as post them you call your buisness layer to execute the buisness logic . In controllers we just receive the incoming requests and data and then pass it to the buisness layer , and once buisness layer returns an output , we structure the API response in controllers and send the output . 

-`repositories`-> This folder contains all the logic using which we interact thew DB by writing queries , all the raw queries or ORM queries will go here. 

-`services`-> contains the buisness logic and interacts with repositories for data from the database . 

-`utils`-> contains helper methods , error classes etc. 

### Setup the project

-Dowmload this template from github and open it in your favourite text editor .
- Go inside the folder path and execute the following command:
```
npm install
```

-In the root directory create a `.env` file and add the following env variables 

```
PORT = <port number of your choice>
```
ex:
```PORT=3000
```
-go inside the `src` folder and execute the following command:

```
npx sequelize init
```
-By executing the above command you will get migrations and seeders folders along with a config.json inside the config folder.

-If you are setting up your development environment, then write the username of your db , password of your db and in dialect mention whatever db you are using for ex:mysql , mariadb etc
-If you're setting up test or prod environment, make sure you also replace host with the hosted db url.

-To run the server execute
```
npm run dev
```