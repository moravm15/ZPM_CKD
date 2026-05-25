sap.ui.define(
    [],
    function () {
        "use strict";

        return {
            noteTimestampFormat: function (sValue) {
                return sValue.getDate() + '/' + (sValue.getMonth()+1) + '/' + sValue.getFullYear();
            }
        };
    }
);