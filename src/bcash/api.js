/* eslint-disable semi */
const { curry, is, prop, lensProp, compose, assoc, over, map } = require('ramda');
const { mapped } = require('ramda-lens');
const API = require('../api');
const Coin = require('./coin.js');
const Bitcoin = require('bitcoincashjs-lib');
const constants = require('../constants');
const Helpers = require('../helpers');

const scriptToAddress = coin => {
  const scriptBuffer = Buffer.from(coin.script, 'hex');
  let network = constants.getNetwork(Bitcoin);
  const address = Bitcoin.address.fromOutputScript(scriptBuffer, network).toString();
  return assoc('priv', address, coin)
}

const pushTx = (tx) => {
  const format = 'plain'
  return fetch(`${API.API_ROOT_URL}bch/pushtx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: API.encodeFormData({ tx, format })
  }).then(r =>
    r.status === 200 ? r.text() : r.text().then(e => Promise.reject(e))
  ).then(r =>
    r.indexOf('Transaction Submitted') > -1 ? true : Promise.reject(r)
  )
};

const apiGetUnspents = (as, conf) => {
  const active = as.join('|');
  const confirmations = Helpers.isPositiveNumber(conf) ? conf : -1
  const format = 'json'
  return fetch(`${API.API_ROOT_URL}bch/unspent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: API.encodeFormData({ active, confirmations, format })
  }).then(r =>
    r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e))
  );
}

const multiaddr = (addresses, n = 1) => {
  const active = Helpers.toArrayFormat(addresses).join('|')
  const data = { active, format: 'json', offset: 0, no_compact: true, n, language: 'en', no_buttons: true };
  return fetch(`${API.API_ROOT_URL}bch/multiaddr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: API.encodeFormData(data)
  }).then(r => r.status === 200 ? r.json() : r.json().then(e => Promise.reject(e)));
};

const getChangeIndex = xpub => multiaddr(xpub)
                               .then(prop('addresses'))
                               .then(prop('0'))
                               .then(prop('change_index'))

// getChangeOutput :: Wallet -> Int | [String] -> Promise String
const getChangeOutput = curry((wallet, source) => {
  switch (true) {
    case is(Number, source):
      const account = wallet.hdwallet.accounts[source]
      return getChangeIndex(account.extendedPublicKey)
        .then(index => account.changeAddressAtIndex(index))
    case is(Array, source):
      return source.every(Helpers.isBitcoinAddress)
        ? Promise.resolve(source[0])
        : Promise.reject('INVALID_SOURCE')
    default:
      return Promise.reject('INVALID_SOURCE');
  }
})

// source can be a list of legacy addresses or a single integer for account index
const getUnspents = curry((wallet, source) => {
  switch (true) {
    case is(Number, source):
      const accIdx = wallet.hdwallet.accounts[source].extendedPublicKey
      return apiGetUnspents([accIdx])
                .then(prop('unspent_outputs'))
                .then(over(compose(mapped, lensProp('xpub')), assoc('index', source)))
                .then(map(Coin.fromJS));
    case is(Array, source):
      return apiGetUnspents(source)
                .then(prop('unspent_outputs'))
                .then(over(mapped, scriptToAddress))
                .then(map(Coin.fromJS));
    default:
      return Promise.reject('WRONG_SOURCE_FOR_UNSPENTS');
  }
})

module.exports = {
  getUnspents,
  pushTx,
  getChangeOutput,
  multiaddr
};
