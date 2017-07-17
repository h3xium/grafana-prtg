import angular from 'angular';
import _ from 'lodash';
import * as utils from './utils';
import { XMLXform } from './xmlparser';
/**
 * PRTG API Service
 * Implements the high level functions that process data from PRTG
 */

/** @ngInject */
function PRTGAPIService(alertSrv, backendSrv) {
    
    class PRTGAPI {
        constructor (api_url, username, passhash, cacheTimeoutMinutes) {
          this.url              = api_url;
          this.username         = username;
          this.passhash         = passhash;
          this.lastId           = false;
          this.cache            = {};
          this.cacheTimeoutMinutes = cacheTimeoutMinutes;
          this.alertSrv         = alertSrv;
          this.backendSrv       = backendSrv;
          
        }
        
        /**
         * Tests whether a url has been stored in the cache.
         * Returns boolean true | false
         */
        inCache(url) {
            if ((Date.now() - this.cache[this.hashValue(url)]) > (this.cacheTimeoutMinutes * 60 * 1000)) {
                return false;
            }
            if (this.cache[this.hashValue(url)]) {
                return true;
            }
            return false;
        }
        
        /**
        * retrieves a cached data result from the cache
        *
        * @param  url the URL of the request
        * @return promise
        */
        getCache(url)    {
            return Promise.resolve(this.cache[this.hashValue(url)]);
        }
        
        /**
        * stores a data result in the cache
        *
        * @param  url the URL of the request
        * @param  data the response.data object of the request
        * @return promise
        */
        setCache(url, data)    {
            this.cache[this.hashValue(url)] = data;
            return this.getCache(url);
        }
        
        /**
        * simple clone of a java hash value
        * Kevin "Pancake" (http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/)
        *
        * @param  e string to hash
        * @return int32
        */
        hashValue(str) {
            var hash = 0;
            if (str.length === 0) return hash;
            for (var i = 0; i < str.length; i++) {
                var chr = str.charCodeAt(i);
                hash = ((hash<<5)-hash)+chr;
                hash = hash & hash; // Convert to 32bit integer
            }
            return hash;
        }
        
        /**
         * pad date parts and optionally add one
         */
        pad(i,a)	{
            if (a) return ("0" + (i + 1)).slice(-2);
            return ("0" + i).slice(-2);
        }
        
        /**
        * convert a UNIX timestamp into a PRTG date string for queries
        * YYYY-MM-DD-HH-MM-SS
        */
        getPRTGDate(unixtime) 	{
            var d = new Date(unixtime * 1000);
            var s = [d.getFullYear(), this.pad(d.getMonth(),true), this.pad(d.getDate()), this.pad(d.getHours()), this.pad(d.getMinutes()), this.pad(d.getSeconds())];
            return s.join("-");
        }
	
        /**
         * Request data from PRTG API
         *
         * @param  method the API method (e.g., table.json)
         * @param  params HTTP query string query parameters
         * @return promise
         */
        performPRTGAPIRequest(method, params) {
            var queryString = 'username=' + this.username + '&passhash=' + this.passhash + '&' + params;
            var options = {
                method: 'GET',
                url: this.url + '/' + method + '?' + queryString
            };
            
            if (this.inCache(options.url)) {
              return this.getCache(options.url);
            } else {
              return this.setCache(options.url, this.backendSrv.datasourceRequest(options)
                .then(response => {
                    if (!response.data) {
                        return Promise.reject({message: "Response contained no data"});
                    } 
                    
                    if (response.data.groups) {
                      return response.data.groups;
                    }
                    else if (response.data.devices) {
                      return response.data.devices;
                    }
                    else if (response.data.sensors) {
                      return response.data.sensors;
                    }
                    else if (response.data.channels) {
                      return response.data.channels;
                    }
                    else if (response.data.values) {
                      return response.data.values;
                    }
                    else if (response.data.sensordata) {
                      return response.data.sensordata;
                    }
                    else if (response.data.messages) {
                      return response.data.messages;
                    }
                    else if (response.data.Version) { //status request
                      return response.data;
                    } else {  //All else is XML from table.xml so throw it into the transformer and get JSON back.
                      if (response.data == "Not enough monitoring data") {
                        //Fixes Issue #5 - reject the promise with a message. The message is displayed instead of an uncaught exception.
                        return Promise.reject({message: "Not enough monitoring data.\n\nRequest:\n" + params + "\n"});
                      }
                      if (response.data.length > 200) {
                        return new XMLXform(method, response.data);
                      } else {
                        console.log("Short Response! :( \n" + response.data);
                        return {};
                      } 
                    }
              }, error => {
                return Promise.reject(error.status + ": " + error.statusText);
              }));
            }   
        }
    
        getVersion() {
            return this.performPRTGAPIRequest('status.json').then(function (response) {
                if (!response)
                {
                  return "ERROR. No response.";
                } else {
                  return response.Version;
                }
            });
        }
    
        /**
         * Authenticate to the PRTG interface
         * not implemented yet (pass username/pass as query string/POST data)
         */
        performPRTGAPILogin() {
            var username = this.username;
            var passhash = this.passhash;
            var options = {
                method: 'GET',
                url: this.url + "/getstatus.htm?id=0&username=" + username + "&passhash=" + passhash
            };
            return this.backendSrv.datasourceRequest(options).then(response => {
                this.passhash = response;
                return response;
            });
        }
    
        /**
         * Query API for list of groups
         *
         * @return promise - JSON result set
         */
        performGroupSuggestQuery() {
            var params = 'content=groups&columns=objid,group,probe,tags,active,status,message,priority';
            return this.performPRTGAPIRequest('table.json', params);
        }
    
        /**
         * Query API for list of devices
         *
         * @return promise - JSON result set
         */
        performDeviceSuggestQuery(groupFilter) {
            var params = 'content=devices&columns=objid,device,group,probe,tags,active,status,message,priority';
            if (groupFilter) {
                params += ',group' + groupFilter;
            }
            return this.performPRTGAPIRequest('table.json', params);
        }
    
        /**
         * Query API for list of sensors bound to a given device
         *
         * @return promise - JSON result set
         */
        performSensorSuggestQuery(deviceFilter) {
            var params = 'content=sensors&columns=objid,sensor,device,group,probe,tags,active,status,message,priority' + deviceFilter;
            return this.performPRTGAPIRequest('table.json', params);
        }
    
 
        filterQuery(items, queryStr, invert = false) {
            /**
             * group device sensor includes properties:
             * objid: num
             * sensor: Name
             * device: Device name
             * group: Group name
             * tags: comma separated
             * active: true|false
             * active_raw: -1 for true? wtf
             * status: Status text
             * status_raw: number
             * message: html message
             * message_raw: text message
             * priority: number 1-5
             */
            var filterItems = [];
            if (queryStr.match(/{[^{}]+}/g)) {
                filterItems = _.trim(queryStr, '{}').split(',');
            } else {
                filterItems.push(queryStr);
            }
            return _.filter(items, item => {
                
                var findItem;
                if (item.group && !item.device) {
                    findItem = item.group;
                } else if (item.device && !item.sensor) {
                    findItem = item.device;
                } else if (item.sensor && !item.name) {
                    findItem = item.sensor;
                } else if (item.name) {
                    //console.log("FILTER: item.name " + JSON.stringify(item,'',4));
                    findItem = item.name;
                } else {
                    return false;
                }
                if (utils.isRegex(queryStr)) {
                    var rex = utils.buildRegex(queryStr);
                    var result = rex.test(findItem);
                    if (invert) {
                        return !result;
                    }
                    return result;
                }
                if (filterItems.length === 0) {
                    return true;
                }
                if (invert) {
                    return !filterItems.includes(findItem);
                }
                //console.log("FILTERITEMS: " + JSON.stringify(filterItems,'',4));
                //console.log("FINDITEM: " + JSON.stringify(findItem,'',4));
                return filterItems.includes(findItem);
            });
        }
 
        getGroups(groupFilter = '/.*/') {
            console.log("getGroups('" + groupFilter + "')");
            return this.performGroupSuggestQuery().then(groups => {
                return this.filterQuery(groups, groupFilter);
            });
        }
        
        getHosts(groupFilter = '/.*/', hostFilter = '/.*/') {
            return this.getGroups(groupFilter)
            .then(filteredGroups => {
                var filters = []; 
                _.each(filteredGroups, group => {
                    filters.push('filter_group=' + group.group);
                });
                return this.performDeviceSuggestQuery("&" + filters.join('&')).then(devices => {
                    return this.filterQuery(devices, hostFilter);
                });
            });
        }
        
        getSensors (groupFilter = '/.*/', hostFilter = '/.*/', sensorFilter = '/.*/') {
            return this.getHosts(groupFilter, hostFilter).then(hosts => {
                var filters = [];
                _.each(hosts, host => {
                    filters.push('filter_device=' + host.device);
                });
                return this.performSensorSuggestQuery("&" + filters.join('&')).then(sensors => {
                    return this.filterQuery(sensors, sensorFilter);
                });
            });
        }

        getAllItems(groupFilter = '/.*/', hostFilter = '/.*/', sensorFilter = '/.*/') {
            return this.getSensors(groupFilter, hostFilter, sensorFilter).then(sensors => {
                
                /**
                 * In this context, if i simply iterate an array with _.each and then execute performPRTGAPIRequest, even
                 * though the returned object is a promise which can be used in a chain, the execution falls outside of the existing
                 * promise chain and thus executs asynchronously. To keep everything in the same execution context, create a
                 * promise array for each object, then execute them in context.
                 */
                var promises = _.map(sensors, sensor => {
                    var params = 'content=channels&columns=sensor,name&id=' + sensor.objid;
                    return this.performPRTGAPIRequest('table.json', params)
                        .then(channels => {
                            /**
                             * Create an object that contains all of the information necessary to query this metric.
                             * This information will be used at render time to group the datapoints and name them.
                             */
                            return Promise.all(_.map(channels, channel => {
                                channel.sensor = sensor.objid;
                                channel.sensor_raw = sensor.sensor;
                                channel.device = sensor.device;
                                channel.group = sensor.group;
                                channel.channel = channel.name;
                                return channel;
                            }));
                        });
                });
                return Promise.all(promises).then(_.flatten);
            });
        }
    
        getItems(groupFilter, deviceFilter, sensorFilter, channelFilter, invertChannelFilter = false) {
            return this.getAllItems(groupFilter, deviceFilter, sensorFilter).then(items => {
                return this.filterQuery(items, channelFilter, invertChannelFilter);
                //return _.filter(items, item => {
                //    return this.filterMatch(item.name, channelFilter, invertChannelFilter);
                //});
            });
        }
        getItemsFromTarget(target) {
            /*
             * Flow: is group filter present?
             * yes: Get groups(filter)
             * no: get device
             */
            
            if (target.options) {
                if(target.options.invertChannelFilter) {
                    return this.getItems(target.group.name, target.device.name, target.sensor.name, target.channel.name, true);
                } else {
                    return this.getItems(target.group.name, target.device.name, target.sensor.name, target.channel.name);
                }
            }
            return this.getItems(target.group.name, target.device.name, target.sensor.name, target.channel.name);
                
        }
    
        /*
         * Replaces getValues
         */
        getItemHistory(sensor, channel, dateFrom, dateTo) {
            var hours = ((dateTo-dateFrom) / 3600);
            var avg = 0;
            if (hours > 12 && hours < 36) {
                avg = "300";
            } else if (hours > 36 && hours < 745) {
                avg = "3600";
            } else if (hours > 745) {
                avg = "86400";
            }
        
            var method = "historicdata.xml";
            var params = "id=" + sensor + "&sdate=" + this.getPRTGDate(dateFrom) + "&edate=" + this.getPRTGDate(dateTo) + "&avg=" + avg + "&pctshow=false&pctmode=false";
            /*
             * Modified to read the "statusid" value, this can then be mapped via lookup table to a PRTG status type
             * 1=Unknown, 2=Scanning, 3=Up, 4=Warning, 5=Down, 6=No Probe, 7=Paused by User, 8=Paused by Dependency,
             * 9=Paused by Schedule, 10=Unusual, 11=Not Licensed, 12=Paused Until, 13=Down Acknowledged, 14=Down Partial
             */
            var history = [];
            if (channel == 'Status') {
                params = "&id=" + sensor;
                return this.performPRTGAPIRequest('getsensordetails.json', params).then(results => {
                    history.push({sensor:sensor, channel:"Status", datetime: Date.now(), value: results.statusid});
                    return history;
                });
            } else {
                return this.performPRTGAPIRequest(method, params).then(results => {
                
                    if (!results.histdata) {
                        return history;
                    }
                    var rCnt = results.histdata.item.length;

                    for (var i=0;i<rCnt;i++)
                    {
                        var v;
                        var prtgDate = results.histdata.item[i].datetime_raw;
                        var dt = new Date((prtgDate - (25569)) * 86400 * 1000);
                        //var dt = Math.round((results.histdata.item[i].datetime_raw - 25568) * 86400,0) * 1000;
                        if (results.histdata.item[i].value_raw && (results.histdata.item[i].value_raw.length > 0))
                        {
                            //FIXME: better way of dealing with multiple channels of same name
                            //IE you select "Traffic In" but PRTG provides Volume AND Speed channels.
                            for (var j = 0; j < results.histdata.item[i].value_raw.length; j++) {
                              //workaround for SNMP Bandwidth Issue #3. Check for presence of (speed) suffix, and use that.
                              if (results.histdata.item[i].value_raw[j].channel.match(channel + ' [(]speed[)]') || results.histdata.item[i].value_raw[j].channel == channel) {
                                v = Number(results.histdata.item[i].value_raw[j].text);
                              }
                            }
                        } else if (results.histdata.item[i].value_raw) {
                             v = Number(results.histdata.item[i].value_raw.text);
                        }
                        history.push({sensor: sensor, channel: channel, datetime: dt, value: v});
                    }
                    return history;
                });
            }
        }
    
        /**
         * Retrieve messages for a given sensor.
         * 
         * @param from Earliest time in range
         * @param to Latest time in range
         * @sensorId Numeric ID of Sensor 
         */
        getMessages(from, to, sensorId) {
         var method = "table.json";
          var params = "&content=messages&columns=objid,datetime,parent,type,name,status,message&id=" + sensorId;
          return this.performPRTGAPIRequest(method, params).then(function(messages) {
            var events = [];
            var time = 0;
              _.each(messages, function(message) {
                time = Math.round((message.datetime_raw - 25569) * 86400,0);
                if (time > from && time < to) {
                  events.push({
                  time: time * 1000,
                  title: message.status,
                  text: '<p>' + message.parent + '(' + message.type + ') Message:<br>'+ message.message +'</p>'
                  });
                }
              });
              return events;
            });
        }
    }
    return PRTGAPI;
}

//register a new module
angular.module('grafana.services').factory('PRTGAPIService', PRTGAPIService);
