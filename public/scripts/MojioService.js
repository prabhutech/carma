'use strict'
/*global angular */
// http://sandbox.api.moj.io/v1/trips
// http://sandbox.api.moj.io/v1/login/edf86882-f61f-4953-8110-4cc80d3d879d?secretKey=521112b0-8ecc-4a8d-8403-1a0bea242186&userOrEmail=jakedsouza88@gmail.com&password=Admin!23
// http://sandbox.api.moj.io/v1/login/edf86882-f61f-4953-8110-4cc80d3d879d?secretKey=521112b0-8ecc-4a8d-8403-1a0bea242186&userOrEmail=jakedsouza88@gmail.com&password=Admin!23

angular.module('app.services',[])
.factory('MojioService', ['$http',function ($http) {
    debugger;

    var SANDBOX_URL = 'http://sandbox.api.moj.io/v1/';
    var MojioAPIToken = 'MojioAPIToken';

    var APPID = 'edf86882-f61f-4953-8110-4cc80d3d879d';
    var SECRETKEY = '521112b0-8ecc-4a8d-8403-1a0bea242186';

    var loginInfo = {} ;
    var userInfo = {};
    var loggedIn = false;
    var login = function (username,password) {
        userInfo = {username:username,password:password};

       var promise =  $http.post(SANDBOX_URL+'login/'+APPID+'?secretKey='+SECRETKEY+'&userOrEmail='+username+'&password='+password)

       promise.then(function(res){
            loginInfo = res.data ;
            loggedIn = true ;
            console.log('logged in successfully with result :' + angular.toJson(res.data,true) );
        }, function(res){
            console.log('ERROR logging in :' +angular.toJson(res.data,true) );
        });
       console.log('login moji called');
       return promise;

    };

    var logout = function () {
        console.log('logout mojio');
    };

    // http://sandbox.api.moj.io/v1/trips
    var getTrips = function () {
        if(!loggedIn){
            login(userInfo.username,userInfo.password).then(function(){
                getTrips();
            });
        }else {
            $http.get(SANDBOX_URL+'/trips',{
                headers:{
                    MojioAPIToken:loginInfo._id
                }
            }).then(function(res){
                console.log('trips'+ angular.toJson(res.data,true));
            });
        }
    };

    return {
        userInfo:userInfo,
        login : login,
        logout: logout,
        loginInfo: loginInfo,
        getTrips: getTrips
    };


}]);
