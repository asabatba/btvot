import bsql3, { Database } from 'better-sqlite3';
import { XMLParser } from 'fast-xml-parser';
import { decode } from 'html-entities';
import cron from 'node-cron';
import p from 'phin';
import { Telegraf } from 'telegraf';

import * as dotenv from 'dotenv';

dotenv.config();



interface RssArticle {
  guid: string,
  title: string,
  link: string,
  pubDate: string,
  category?: string | string[],
  description?: string,
}

interface RssFeed {
  rss: {
    channel: {
      item: RssArticle[],
    },
  },
}

type FormattedArticle = Omit<RssArticle, "pubDate"> & { pubDate: Date, };

const rssFetchArticles = async (): Promise<FormattedArticle[]> => {

  const res = await p({ url: `https://beteve.cat/feed/` });

  // console.log(res.statusCode, res.headers.location);
  // console.log(res.headers);

  const bodyStr = res.body.toString("utf8");

  const rssBuilder = new XMLParser({ processEntities: true, htmlEntities: true, });
  const rss = rssBuilder.parse(decode(bodyStr)) as RssFeed;

  // console.log(rss);
  const articles = rss.rss.channel.item;
  const formattedArticles = (articles.map
    (({ title, link, pubDate, category, guid, description, ...rest }) =>
      ({ title, link, pubDate: new Date(pubDate), category, guid, description })
    ));
  return formattedArticles;
};

const sendMessageDelay = async (bot: Telegraf, message: string) => {

  await new Promise(res => setTimeout(res, 200 + Math.random() * 100));
  return bot.telegram.sendMessage(`@beteve_news`, message);
};

const rssFetchAndPublish = async (bot: Telegraf, db: Database) => {

  const articles = await rssFetchArticles();

  for (const article of articles) {

    const exists = db
      .prepare(`SELECT * FROM articles WHERE guid = ?`)
      .get(article.guid);

    if (exists) return;

    console.log(`new article: ${article.title}`);
    await sendMessageDelay(bot, `${article.title}\n${article.link}`);

    db
      .prepare(`INSERT INTO articles (guid, title, link, pubDate, category) 
                      VALUES (?, ?, ?, ?, ?)`)
      .run(article.guid, article.title, article.link, article.pubDate.toISOString(),
        JSON.stringify(article.category));
  }

};

const main = async () => {

  if (typeof process.env.BOT_API_KEY !== "string") {
    throw new Error(`env variable BOT_API_KEY is not defined`);
  }
  const BOT_API_KEY = process.env.BOT_API_KEY;

  const db = bsql3('data.db');

  db.exec(`CREATE TABLE IF NOT EXISTS articles 
                  (guid TEXT NOT NULL PRIMARY KEY, title TEXT, link TEXT, pubDate TEXT, category TEXT)`);
  // title, link, pubDate, category, guid

  const bot = new Telegraf(BOT_API_KEY);

  cron.schedule(`*/5 * * * *`, () => {

    console.log(`job start...`);
    rssFetchAndPublish(bot, db);
  })
    .start();
};

main();