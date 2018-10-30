// ****************************************************************************
// *** T5multimarket.js                                                     ***
// ****************************************************************************
// * Purpose: lean, proof of concept strategy to watch multi-markets inside
// * one gekko trading strategy.
// * The goal is to take advantage of the tight price movement relationship
// * between bitcoin and altcoins.
// * Requirements: Async/await gekko core extension, PostgreSQL db and a  
// * second gekko paper trader to feed the db with binance/btc data.
// ****************************************************************************


const _ = require('lodash');
const moment = require('moment')
const util = require ('../core/util.js');
const dirs = util.dirs();
const log = require('../core/log.js');
const config = util.getConfig();
const adapter = config[config.adapter];
const Reader = require('../' + adapter.path + '/reader.js');
const TALIBASYNC = require('../strategies/indicators/TalibAsync.js');

var stratMM = {};


// ***************************************************************************
// * Init a pice percent oszillator for bitcoin and altcoin market
stratMM.init = function () {
    this.name = 'T5 multi market analyzer (BTC)';

    this.reader = new Reader('binance');

    this.ppoAlt = new TALIBASYNC({ indicator: 'ppo', length: 500, options: { optInFastPeriod: 3, optInSlowPeriod: 2, optInMAType: 0 } });
    this.ppoBtc = new TALIBASYNC({ indicator: 'ppo', length: 500, options: { optInFastPeriod: 3, optInSlowPeriod: 2, optInMAType: 0 } });
}


// ***************************************************************************
// * 1 Min. altcoin candle event
stratMM.onCandle = async function (candle, check=true) {
    //read candle for second market (btc)
    var future = candle.start.add(1, 'second').unix();
    var start = candle.start.subtract(1, 'second').unix();
    
    //get foreign candle from db, similar to gekko leecher mode
    this.reader.get(start, future, 'full', async (err, btcCandles) => {
        var amount = _.size(btcCandles);
        
        if(amount === 0) {
            log.debug('no BTC candles');
            resolve();
            return;
        }

        btcCandles[0].start = moment.unix(btcCandles[0].start); //convert from unix epoch to moment
        
        this.ppoBtc.result = await this.ppoBtc.update(btcCandles[0]);
        this.ppoAlt.result = await this.ppoAlt.update(candle);
        
        if (this.ppoBtc.result >= 0.4 && this.ppoAlt.result < this.ppoBtc.result && !this.exposedMM && check) {
            //log.debug('\n\n', 'ETH:', candle.close, candle.start.format() ,this.ppoAlt.result,' ::: BTC:', btcCandles[0].close, btcCandles[0].start.format(), this.ppoBtc.result);
            log.debug('BUY with multimarket strategy...');
            this.exposedMM = true;
            this.advice({
                direction: 'long',
                trigger: {
                    type: 'trailingStop',
                    strategy: 'multimarket',
                    trailPercentage: 1.0
                }
            });
        }
        
        if (this.ppoBtc.result < -0.3) {  
            this.btcFlashcrash = true;
        } else {
            this.btcFlashcrash = false;
        }
    }, 'candles_usdt_btc');
}


// ***************************************************************************
// * Catch trade event completed and store expose info
stratMM.onTrade = function (trade) {
   if (trade.action == 'buy' && trade.trigger != undefined && trade.trigger.strategy == 'multimarket') this.exposedMM = true;
   if (trade.action == 'sell' && trade.trigger != undefined  && trade.trigger.strategy == 'multimarket') this.exposedMM = false;
}


stratMM.update = function (candle) {
    //no need for strat update, we work with onCandle custom batching
}


stratMM.check = function (candle) {
   //no need for strat check, we work with onCandle custom batching and strat execution
}


module.exports = stratMM;
