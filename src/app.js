const Fs = require('fs');
const Constants = require('./constants.js');
const Moment = require('moment');
const {sprintf} = require('sprintf-js');
const Path = require('path');
const Axios = require('axios');
const CsvToJson = require('csvtojson');
const Country = require('./country.js');
const MongoDatabase = require('./mongodb.js')


/**
 * Save data from the downloaded csv file inside the data dir to a MongoDB database
 *
 * @author      Zairon Jacobs <zaironjacobs@gmail.com>
 */
class App {

    constructor() {
        this.csvFileName = '';

        this.csvRows = [];
        this.countryObjects = {};

        this.totalDeaths = 0;
        this.totalActive = 0;
        this.totalRecovered = 0;
        this.totalConfirmed = 0;

        this.mongoDatabase = new MongoDatabase();
    }

    /**
     * Main function for initialization
     */
    async init() {
        console.log('Downloading data...');
        await this.downloadCsvFile();

        console.log('Saving data to database...');
        await this.setRowsData();
        this.createCountryObjects();
        this.populateCountryObjects();
        await this.saveDataToDb();

        console.log('Finished');
    }

    /**
     * Download any file to the data dir
     */
    async download(url) {
        const pathDataFile = Path.dirname(__filename) + '/' + Constants.DATA_DIR + '/' + this.csvFileName;
        const writer = Fs.createWriteStream(pathDataFile);

        const response = await Axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }

    /**
     * Download the csv file
     */
    async downloadCsvFile() {
        const pathDataDir = Path.dirname(__filename) + '/' + Constants.DATA_DIR;
        if (!Fs.existsSync(pathDataDir)) {
            Fs.mkdirSync(pathDataDir);
        }

        const tries = 90;
        for (let i = 0; i < tries; i++) {
            const date_string = Moment().subtract(i, 'days').format('MM-DD-YYYY');
            this.csvFileName = date_string + '.csv';
            const url = sprintf(Constants.DATA_URL, this.csvFileName);

            try {
                await this.download(url);
                console.log('Download completed: ' + this.csvFileName);
                return;
            } catch {
                const pathFileToDelete = Path.dirname(__filename) + '/' + Constants.DATA_DIR
                    + '/' + this.csvFileName;
                Fs.unlinkSync(pathFileToDelete);
            }
        }
        console.log('Download failed: Unable to find the latest csv file for the last ' + tries + ' days');
    }

    /**
     * Return an array with all country names
     *
     * @return {array}
     */
    getCountryNamesArray() {
        let countryNames = [];
        this.csvRows.forEach(row => {
            countryNames.push(row[Constants.COL_COUNTRY]);
        });
        countryNames.push(Constants.WORLDWIDE);
        return [...new Set(countryNames)];
    }

    /**
     * Create country objects of all countries
     */
    createCountryObjects() {
        const countryNames = this.getCountryNamesArray();
        const lastUpdatedBySourceTime = this.getLastUpdatedBySourceTime()
        countryNames.forEach(countryName => {
            const country = new Country();
            country.setName(countryName);
            country.setLastUpdatedBySourceAt(lastUpdatedBySourceTime);
            this.countryObjects[country.getName()] = country;
        });
    }

    /**
     * Retrieve all rows from the csv file inside the data dir
     */
    async setRowsData() {
        const pathDataFile = Path.dirname(__filename) + '/' + Constants.DATA_DIR + '/' + this.csvFileName;
        this.csvRows = await CsvToJson().fromFile(pathDataFile);
    }

    /**
     * Populate all country objects with data retrieved from the csv file
     */
    populateCountryObjects() {

        function getCaseCount(row, columnName) {
            let caseValue = parseInt(row[columnName]);
            if (isNaN(caseValue)) {
                caseValue = 0;
            }
            if (caseValue < 0) {
                caseValue = Math.abs(caseValue);
            }
            return caseValue;
        }

        this.csvRows.forEach(row => {
                const countryName = row[Constants.COL_COUNTRY];

                const deaths = getCaseCount(row, [Constants.COL_DEATHS]);
                this.totalDeaths += deaths;

                const confirmed = getCaseCount(row, [Constants.COL_CONFIRMED]);
                this.totalConfirmed += confirmed;

                const active = getCaseCount(row, [Constants.COL_ACTIVE]);
                this.totalActive += active;

                const recovered = getCaseCount(row, [Constants.COL_RECOVERED]);
                this.totalRecovered += recovered;

                const country = this.countryObjects[countryName];
                country.incrementDeaths(deaths);
                country.incrementConfirmed(confirmed);
                country.incrementActive(active);
                country.incrementRecovered(recovered);
            }
        );

        const country_worldwide = this.countryObjects[Constants.WORLDWIDE];
        country_worldwide.incrementDeaths(this.totalDeaths);
        country_worldwide.incrementConfirmed(this.totalConfirmed);
        country_worldwide.incrementActive(this.totalActive);
        country_worldwide.incrementRecovered(this.totalRecovered);
    }

    /**
     * Return the last updated time of the data
     *
     * @return {Date}
     */
    getLastUpdatedBySourceTime() {
        const dateString = this.csvRows[0][Constants.COL_LAST_UPDATE];
        const date_moment = Moment(dateString);
        return new Date(Date.UTC(
            date_moment.year(), date_moment.month(), date_moment.date(),
            date_moment.hours(), date_moment.minute(), date_moment.second()))
    }

    /**
     * Save each country object to a MongoDB database
     */
    async saveDataToDb() {
        await this.mongoDatabase.connect();

        await this.mongoDatabase.dropCollection();
        const values = Object.values(this.countryObjects)
        for (const value of values) {
            await this.mongoDatabase.insert(value);
        }

        await this.mongoDatabase.close();
    }
}

module.exports = App;
