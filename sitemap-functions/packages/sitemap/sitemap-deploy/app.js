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

const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
  }
  return result;
};


async function generateAndUploadSitemap() {
  try {
    const media = await Media.findAll({
      where: { is_published: true },
      attributes: ['slug', 'language'],
      order: [['id', 'ASC']]
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

    let mediaChunks = chunkArray(media, 1000);
  

    // Create sitemaps
    mediaChunks.forEach(async (chunk, index) => {
      const urlset = {
          '$': {
              'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
          },
          'url': chunk.map(m => ({
              'loc': [`https://www.vroom.be/${m.language}/${m.language === 'fr' ? 'information' : 'informatie'}/${m.slug}`],
              'priority': ['0.8']
          }))
      };

      // Build XML
      const xml = builder.buildObject(urlset);

      // Write to file
      const filename = `media-sitemap-${String(index + 1).padStart(4, '0')}.xml`;
      fs.writeFileSync(filename, xml, 'utf8');
      await uploadFileToS3(filename);
    });

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9',
            'xmlns:news': 'http://www.google.com/schemas/sitemap-news/0.9'
        },
        'url': []
    };

    const rssFr = {
        rss: {
            $: {
                version: '2.0'
            },
            channel: [
                {
                    title: 'Vroom.be',
                    link: 'https://www.vroom.be/fr',
                    description: "Découvrez tout ce qu'il faut savoir sur l'actualité automobile: des essais aux dernières actualités, en passant par les prix et les conseils d'experts.",
                    language: 'fr',
                    item: []
                }
            ]
        }
    };
    
    const rssNl = {
        rss: {
            $: {
                version: '2.0'
            },
            channel: [
                {
                    title: 'Vroom.be',
                    link: 'https://www.vroom.be/nl',
                    description: "Nieuwe en tweedehands auto's veilig vergelijken en kopen? Dat doe je op Vroom! Ontdek hier +40.000 wagens, +20.000 tests, nieuws, advies en prijzen.",
                    language: 'nl',
                    item: []
                }
            ]
        }
    };

    recentMedia.forEach(media => {
        const loc = `https://www.vroom.be/${media.language === 'fr' ? 'fr/information' : 'nl/informatie'}/${media.slug}`;
        const rssItem = {
            title: media.meta_title,
            link: loc,
            description: media.meta_description || '', 
            pubDate: new Date(media.published_at).toUTCString(),
            guid: loc,
        };
    
        if (media.language === 'fr') {
            rssFr.rss.channel[0].item.push(rssItem);
        } else if (media.language === 'nl') {
            rssNl.rss.channel[0].item.push(rssItem);
        }
        const newsItem = {
            'loc': loc,
            'news:news': {
                'news:publication': {
                    'news:name': 'Vroom',
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

    xml = rssBuilder.buildObject(rssFr);
    fs.writeFileSync('fr-rss.xml', xml, 'utf8');

    xml = rssBuilder.buildObject(rssNl);
    fs.writeFileSync('nl-rss.xml', xml, 'utf8');

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    const urls = [];
    listings.forEach(l => {
        if (l.dataValues.vehicle_status_id === '1') {
            urls.push({ 'loc': `https://www.vroom.be/fr/voitures-neuves/${l.slug}`, 'priority': '0.7' });
            urls.push({ 'loc': `https://www.vroom.be/nl/nieuwe-autos/${l.slug}`, 'priority': '0.7' });
        } else if (l.dataValues.vehicle_status_id === '2') {
            urls.push({ 'loc': `https://www.vroom.be/fr/voitures-occasion/${l.slug}`, 'priority': '0.7' });
            urls.push({ 'loc': `https://www.vroom.be/nl/tweedehands-autos/${l.slug}`, 'priority': '0.7' });
        } else if (l.dataValues.vehicle_status_id === '3') {
            urls.push({ 'loc': `https://www.vroom.be/fr/anciennes/${l.slug}`, 'priority': '0.7' });
            urls.push({ 'loc': `https://www.vroom.be/nl/oldtimers/${l.slug}`, 'priority': '0.7' });
        }
    });

    let listingsChunks = chunkArray(urls, 1000);


    listingsChunks.forEach(async (chunk, index) => {
      const urlset = {
          '$': {
              'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
          },
          'url': chunk
      };
  
      // Build XML
      const xml = builder.buildObject(urlset);
  
      // Write to file
      const filename = `listings-sitemap-${String(index + 1).padStart(4, '0')}.xml`;
      fs.writeFileSync(filename, xml, 'utf8');
      await uploadFileToS3(filename);
  });

    urlset = {
        '$': {
            'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9'
        },
        'url': []
    };

    tags.forEach(t => {
        urlset.url.push({ 'loc': `https://www.vroom.be/fr/tag/${t.slug}`, 'priority': '0.7' });
        urlset.url.push({ 'loc': `https://www.vroom.be/nl/tag/${t.slug}`, 'priority': '0.7' });
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
        urlset.url.push({ 'loc': `https://www.vroom.be/fr/information/${b.slug}`, 'priority': '0.8' });
        urlset.url.push({ 'loc': `https://www.vroom.be/nl/informatie/${b.slug}`, 'priority': '0.8' });
        urlset.url.push({ 'loc': `https://www.vroom.be/fr/${b.slug}`, 'priority': '0.8' });
        urlset.url.push({ 'loc': `https://www.vroom.be/nl/${b.slug}`, 'priority': '0.8' });

        let series = await sequelize.query('SELECT id, brand_id, slug, language, is_trending FROM car_database_series WHERE brand_id = ?', {
            replacements: [b.dataValues.id],
            type: QueryTypes.SELECT,
          });

        series.forEach(async s => {
            seriesUrlSet.url.push({ 'loc': `https://www.vroom.be/${s.language}/${b.slug}/${s.slug}`, 'priority': '0.8' });
          });

    });

    xml = builder.buildObject(urlset);
    fs.writeFileSync('brands-sitemap.xml', xml, 'utf8');

    xml = builder.buildObject(seriesUrlSet);
    fs.writeFileSync('series-sitemap.xml', xml, 'utf8');


    const sitemapEntries = [
      { loc: 'https://www.vroom.be/static-sitemap.xml' },
      { loc: 'https://www.vroom.be/news-sitemap.xml' },
      ...mediaChunks.map((_, index) => ({
          loc: `https://www.vroom.be/media-sitemap-${String(index + 1).padStart(4, '0')}.xml`
      })),
      ...listingsChunks.map((_, index) => ({
          loc: `https://www.vroom.be/listings-sitemap-${String(index + 1).padStart(4, '0')}.xml`
      })),
      { loc: 'https://www.vroom.be/tags-sitemap.xml' },
      { loc: 'https://www.vroom.be/brands-sitemap.xml' }
  ];

  const sitemapIndex = {
      'sitemapindex': {
          '$': { 'xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9' },
          'sitemap': sitemapEntries
      }
  };

    // Build XML
    xml = builder.buildObject(sitemapIndex);

    // Write to file
    fs.writeFileSync('sitemapindex.xml', xml, 'utf8');
    await uploadFileToS3("sitemapindex.xml")
    await uploadFileToS3("fr-rss.xml")
    await uploadFileToS3("nl-rss.xml")
    await uploadFileToS3("series-sitemap.xml")
    await uploadFileToS3("brands-sitemap.xml")
    await uploadFileToS3("tags-sitemap.xml")
    return await uploadFileToS3("news-sitemap.xml")
  } catch (error) {
    console.error('Failed to generate or upload sitemap:', error);
  }
}

function uploadFileToS3(filename) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filename);
    const params = {
      Bucket: "vroom-be",
      Key: "vroom-be/" + filename,
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


