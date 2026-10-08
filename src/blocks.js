'use strict';
// Building blocks for the home page. Administrators can reorder, hide, edit and add them.
const { f } = require('./layouts');

const BLOCKS = {
  hero: {
    label: 'Welcome banner',
    fields: [
      f('kicker', 'Small heading', 'text'),
      f('title', 'Main heading', 'text'),
      f('motto', 'Motto', 'text'),
      f('background', 'Background photo', 'image'),
      f('buttons', 'Buttons', 'links'),
    ],
  },
  notices: {
    label: 'Scrolling notices',
    fields: [f('section', 'Take notices from', 'section', { layout: 'notices' })],
  },
  message: {
    label: 'Message with photo (Chief Judge)',
    fields: [
      f('photo', 'Photo', 'image'),
      f('heading', 'Heading', 'text'),
      f('quote', 'Highlighted quote', 'textarea'),
      f('body', 'Message', 'richtext'),
      f('name', 'Name', 'text'),
      f('title', 'Title', 'text'),
    ],
  },
  feature: {
    label: 'Text with picture',
    fields: [
      f('heading', 'Heading', 'text'),
      f('text', 'Text', 'richtext'),
      f('image', 'Picture', 'image'),
      f('buttonLabel', 'Button label', 'text'),
      f('buttonUrl', 'Button link', 'text'),
    ],
  },
  promo: {
    label: 'Highlight box with checklist',
    fields: [
      f('heading', 'Heading', 'text'),
      f('lead', 'Introduction', 'richtext'),
      f('bullets', 'Checklist', 'list'),
      f('image', 'Side picture', 'image'),
      f('buttonLabel', 'Button label', 'text'),
      f('buttonUrl', 'Button link', 'text'),
    ],
  },
  section: {
    label: 'Items from a section',
    fields: [
      f('section', 'Section', 'section'),
      f('kicker', 'Small heading', 'text'),
      f('heading', 'Heading', 'text'),
      f('intro', 'Introduction', 'textarea'),
      f('limit', 'How many items to show (0 means all)', 'number'),
      f('buttonLabel', 'Button label (links to the full section)', 'text'),
    ],
  },
  contact: {
    label: 'Contact details, form and map',
    fields: [
      f('heading', 'Heading', 'text'),
      f('intro', 'Introduction', 'text'),
      f('showForm', 'Show the message form', 'toggle'),
      f('showMap', 'Show the map', 'toggle'),
    ],
  },
  richtext: {
    label: 'Free text',
    fields: [f('heading', 'Heading', 'text'), f('body', 'Content', 'richtext')],
  },
};

module.exports = { BLOCKS };
