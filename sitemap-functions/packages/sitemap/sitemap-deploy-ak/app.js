require('dotenv').config();

const { sequelize, Media, Listing, Tag, Brand, CarSeries} = require('./models');
const AWS = require('aws-sdk');
const fs = require('fs');
const xml2js = require('xml2js');
const { Op, QueryTypes} = require("sequelize");


// Configure AWS
AWS.config.update({
  region: 'us-east-1',
  credentials: new AWS.Credentials(process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY)
});

const s3 = new AWS.S3({
    endpoint: "https://fra1.digitaloceanspaces.com"
});
const builder = new xml2js.Builder({
    rootName: 'urlset',
    xmldec: { version: '1.0', encoding: 'UTF-8' }
});

const rssBuilder = new xml2js.Builder({
    xmldec: { version: '1.0', encoding: 'UTF-8' }
});

async function generateAndUploadSitemap() {
  try {
    const media = await Media.findAll({
      where: { is_published: true },
      limit: 49500,
      attributes: ['slug', 'language'],
      order: [['id', 'DESC']]
    });

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const recentMedia  = await Media.findAll({
        where: {
          is_published: true,
          published_at: {
            [Op.gte]: twoDaysAgo
          }
        },
        limit: 49500,
        attributes: ['slug', 'published_at', 'created_at', 'meta_title', 'meta_description', 'language']
      });

    const listings = await Listing.findAll({
      where: {
        is_published: true,
        mileage: { [Op.gte]: 0 },
        price: { [Op.gte]: 800 }
      },
      attributes: ['vehicle_status_id', 'slug']
    });

    const tags = await Tag.findAll({
        where: {
          is_active: true,
        },
        attributes: ['id', 'slug']
      });

      const brands = await Brand.findAll({
        where: {
          drop_down_presence: true,
        },
        attributes: ['id', 'slug']
      });

    let urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': media.map(m => ({
            'loc': [`https://www.autokopen.nl/nieuws/${m.slug}`],
            'priority': ['0.75']
        }))
    };
    let xml = builder.buildObject(urlset);
    fs.writeFileSync('media-sitemap.xml', xml, 'utf8');

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9',
            'xmlns:news': 'http://www.google.com/schemas/sitemap-news/0.9'
        },
        'url': []
    };

    const rssNl = {
        rss: {
            $: {
                version: '2.0'
            },
            channel: [
                {
                    title: 'Autokopen.nl',
                    link: 'https://www.autokopen.nl/',
                    description: "Autokopen - Stap in de toekomst van transparante auto-aankopen",
                    language: 'nl',
                    item: []
                }
            ]
        }
    };
    

    recentMedia.forEach(media => {
        const loc = `https://www.autokopen.nl/nieuws/${media.slug}`;
        const rssItem = {
            title: media.meta_title,
            link: loc,
            description: media.meta_description || '', 
            pubDate: new Date(media.published_at).toUTCString(),
            guid: loc,
        };
    
            rssNl.rss.channel[0].item.push(rssItem);

        const newsItem = {
            'loc': loc,
            'news:news': {
                'news:publication': {
                    'news:name': 'Autokopen',
                    'news:language': media.language
                },
                'news:publication_date': media.published_at.toISOString().split('T')[0], // Format date to YYYY-MM-DD
                'news:title': media.meta_title
            }
        };
        urlset.url.push(newsItem);
    });

    xml = builder.buildObject(urlset);
    fs.writeFileSync('news-sitemap.xml', xml, 'utf8');


    xml = rssBuilder.buildObject(rssNl);
    fs.writeFileSync('nl-rss.xml', xml, 'utf8');

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    listings.forEach(l => {
        if (l.dataValues.vehicle_status_id === '1') {
            urlset.url.push({ 'loc': `https://www.autokopen.nl/nieuw/${l.slug}`, 'priority': '0.7' });
        } else if (l.dataValues.vehicle_status_id === '2') {
            urlset.url.push({ 'loc': `https://www.autokopen.nl/tweedehands/${l.slug}`, 'priority': '0.7' });
        }
    });

    xml = builder.buildObject(urlset);
    fs.writeFileSync('listings-sitemap.xml', xml, 'utf8');

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    tags.forEach(t => {
        urlset.url.push({ 'loc': `https://www.autokopen.nl/tag/${t.slug}`, 'priority': '0.7' });
    });

    xml = builder.buildObject(urlset);
    fs.writeFileSync('tags-sitemap.xml', xml, 'utf8');


    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    seriesUrlSet = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    brands.forEach(async b => {
        urlset.url.push({ 'loc': `https://www.autokopen.nl/${b.slug}`, 'priority': '0.8' });
    });

    xml = builder.buildObject(urlset);
    fs.writeFileSync('brands-sitemap.xml', xml, 'utf8');

    await uploadFileToS3("nl-rss.xml")
    await uploadFileToS3("brands-sitemap.xml")
    await uploadFileToS3("tags-sitemap.xml")
    await uploadFileToS3("news-sitemap.xml")
    await uploadFileToS3("listings-sitemap.xml")
    return await uploadFileToS3("media-sitemap.xml")

  } catch (error) {
    console.error('Failed to generate or upload sitemap:', error);
  }
}

function uploadFileToS3(filename) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filename);
    const params = {
      Bucket: "vroom-be",
      Key: "autokopen-nl/" + filename,
      Body: fileStream,
      ACL: "public-read",
      CacheControl: "max-age=600"
    };

    s3.upload(params, function(err, data) {
      if (err) {
        console.error("Error uploading data: ", err);
        reject(err);
      } else {
        console.log("Successfully uploaded data to", data.Location);
        resolve(data);
      }
    });
  });
}

async function main(){
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
    return await generateAndUploadSitemap();
}

exports.main = main


