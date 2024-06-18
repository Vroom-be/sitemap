// models.js
const { Sequelize, DataTypes } = require('sequelize');

// Environment configuration
require('dotenv').config();
const { DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD } = process.env;


const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
        rejectUnauthorized: false,
    }
  },
  logging: false,
  
});

const Media = sequelize.define('Media', {
  slug: {
    type: DataTypes.STRING,
    unique: true,
  },
  language: DataTypes.STRING,
  created_at : DataTypes.DATE,
  published_at : DataTypes.DATE,
  meta_title : DataTypes.STRING,
  meta_description : DataTypes.STRING
}, { tableName: 'media',timestamps: true, });

const Listing = sequelize.define('Listing', {
  vehicle_status_id: DataTypes.INTEGER,
  slug: DataTypes.STRING,
}, { tableName: 'listings' });

const Tag = sequelize.define('Tag', {
    slug: DataTypes.STRING,
  }, { tableName: 'tags' });

const Brand = sequelize.define('Brand', {
    id : {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
    slug: DataTypes.STRING,
  }, { tableName: 'brands' });

const CarSeries = sequelize.define('CarSeries', {
    slug: DataTypes.STRING,
    brand_id: DataTypes.INTEGER,
  }, { tableName: 'car_database_series' });


module.exports = { sequelize, Media, Listing, Tag, Brand, CarSeries};
