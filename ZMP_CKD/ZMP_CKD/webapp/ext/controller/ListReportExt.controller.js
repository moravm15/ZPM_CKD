
sap.ui.define(["sap/ui/core/mvc/Controller", "sap/m/MessageToast", "sap/m/MessageBox", "sap/ui/model/Sorter", "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator", "sap/ui/model/FilterType", "sap/ui/model/json/JSONModel", 'sap/ui/core/Fragment', "sap/m/MenuItem", "../model/formatter", "sap/ui/core/format/DateFormat",],
    function (Controller, MessageToast, MessageBox, Sorter, Filter, FilterOperator, FilterType, JSONModel, Fragment, MenuItem, formatter, DateFormat) {
        "use strict";
        var that = this

        return {

            formatter: formatter,

            onInit: function () {
                that = this;
                this.getView().attachEventOnce("afterRendering", function () {
                    var aSmartTables = this.getView().findAggregatedObjects(true, function (o) {
                        return o.isA && o.isA("sap.ui.comp.smarttable.SmartTable");
                    });
                    if (aSmartTables.length > 0) {
                        this._oMainSmartTable = aSmartTables[0];
                        this._oMainSmartTable.getTable().setRowHeight(100);
                        this._oMainSmartTable.getTable().setColumnHeaderHeight(20)
                        this._oMainSmartTable.attachBeforeRebindTable(this._applyMatnrFilter, this);
                    }
                }, this);
            },

            // Předvyplnění závodu (WRK) a skladu (LAG) z uživatelských parametrů - jen pro standardní variantu
            onInitSmartFilterBarExtension: function (oEvent) {
                console.log("onInitSmartFilterBarExtension")
                var oSmartFilterBar = oEvent.getSource();
                this._applyUserDefaults(oSmartFilterBar);
                oSmartFilterBar.attachAfterVariantLoad(function () {
                    this._applyUserDefaults(oSmartFilterBar);
                }, this);
            },

            _readUserDefaults: function () {
                if (!this._oUserDefaultsPromise) {
                    var oModel = this.getView().getModel();
                    this._oUserDefaultsPromise = new Promise(function (resolve) {
                        oModel.read("/ZPMI_CKD_USER_DEFAULTS", {
                            success: function (oData) {
                                var mDefaults = {};
                                // Jeden řádek za uživatele: Plant (WRK), StorageLocation (LAG)
                                var oRow = (oData.results || [])[0];
                                if (oRow) {
                                    if (oRow.Plant && oRow.PlantIsValid) { mDefaults.werks = oRow.Plant; }
                                    if (oRow.StorageLocation && oRow.IsValid) { mDefaults.lgort = oRow.StorageLocation; }
                                }
                                resolve(mDefaults);
                            },
                            error: function () {
                                resolve({});
                            }
                        });
                    });
                }
                return this._oUserDefaultsPromise;
            },

            _isStandardVariant: function (oSmartFilterBar) {
                var oVariant = oSmartFilterBar.getSmartVariant && oSmartFilterBar.getSmartVariant();
                if (!oVariant) { return true; }
                var sCurrent = oVariant.getCurrentVariantId();
                var sStandard = oVariant.getStandardVariantKey ? oVariant.getStandardVariantKey() : "*standard*";
                return !sCurrent || sCurrent === sStandard;
            },

            _applyUserDefaults: function (oSmartFilterBar) {
                if (!this._isStandardVariant(oSmartFilterBar)) { return; }

                this._readUserDefaults().then(function (mDefaults) {
                    // Varianta se mezitím mohla změnit
                    if (!this._isStandardVariant(oSmartFilterBar)) { return; }

                    var oCurrent = oSmartFilterBar.getFilterData() || {};
                    var oNewData = {};
                    Object.keys(mDefaults).forEach(function (sKey) {
                        var oControl = oSmartFilterBar.getControlByKey(sKey);
                        if (!oControl) { return; }
                        var vValue = oCurrent[sKey];
                        var bFilled = vValue && (typeof vValue === "string" ||
                            (vValue.items && vValue.items.length) || (vValue.ranges && vValue.ranges.length) || vValue.value);
                        if (bFilled) { return; }
                        // MultiInput potřebuje token (items), jinak by hodnotu nepoznal a pole zůstalo chybné
                        oNewData[sKey] = oControl.getTokens ? { items: [{ key: mDefaults[sKey] }] } : mDefaults[sKey];
                    });
                    if (!Object.keys(oNewData).length) { return; }

                    oSmartFilterBar.setFilterData(oNewData, false);
                    Object.keys(oNewData).forEach(function (sKey) {
                        var oControl = oSmartFilterBar.getControlByKey(sKey);
                        if (oControl.setValue && oControl.getTokens) { oControl.setValue(""); }
                        if (oControl.setValueState) { oControl.setValueState("None"); }
                    });
                    oSmartFilterBar.fireFilterChange();
                }.bind(this));
            },

            _applyMatnrFilter: function (oEvent) {
                var oBinding = oEvent.getParameter("bindingParams");

                // Zabráni dvojitému přidání filtru (pokud se zavolá z obou míst)
                var bAlreadyApplied = oBinding.filters.some(function (f) {
                    return f.sPath === "matnr" ||
                        (f.aFilters && f.aFilters[0] && f.aFilters[0].sPath === "matnr");
                });
                if (bAlreadyApplied) { return; }

                var oSmartFilterBar = this.getView().byId("listReportFilter");
                if (!oSmartFilterBar) { return; }

                var oInput = oSmartFilterBar.getControlByKey("matnr");
                if (!oInput || !oInput.getTokens) { return; }

                var aTokens = oInput.getTokens();
                if (!aTokens.length) { return; }

                var aConditions = aTokens.map(function (oToken) {
                    var oRange = oToken.data("range");
                    if (oRange) {
                        return new Filter("matnr", oRange.operation, oRange.value1, oRange.value2);
                    }
                    return new Filter("matnr", FilterOperator.EQ, oToken.getKey());
                });
                oBinding.filters.push(new Filter(aConditions, false));
            },

            onCallObjednavkaService: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oObjednavkaDialog) {
                    this.oObjednavkaDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.ObjednavkaExtension"
                    });
                }
                var aFilter = [];
                aFilter.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                aFilter.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
                aFilter.push(new Filter("werks", FilterOperator.EQ, this.selectedObject.werks));
                this.oObjednavkaDialog.then(function (oObjednavkaDialog) {
                    oObjednavkaDialog.open();
                });
            },

            onCallSpotrebaService: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oSpotrebaDialog) {
                    this.oSpotrebaDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.SpotrebaExtension"
                    });
                }
                this.oSpotrebaDialog.then(function (oSpotrebaDialog) {
                    oSpotrebaDialog.open();
                });
            },

            onCallKosikService: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oKosikDialog) {
                    this.oKosikDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.KosikExtension"
                    });
                }

                this.oKosikDialog.then(function (oKosikDialog) {
                    oKosikDialog.open();
                });
            },

            onCallPobjService: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oPobjDialog) {
                    this.oPobjDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.PobjExtension"
                    });
                }

                this.oPobjDialog.then(function (oPobjDialog) {
                    oPobjDialog.open();
                });
            },

            onCallBdmngService: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oBdmngDialog) {
                    this.oBdmngDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.BdmngExtension"
                    });
                }
                this.oBdmngDialog.then(function (oBdmngDialog) {
                    oBdmngDialog.open();
                });
            },

            onBeforeRebind: function (oSource) {
                var binding = oSource.getParameter("bindingParams");
                binding.filters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                binding.filters.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
                binding.filters.push(new Filter("werks", FilterOperator.EQ, this.selectedObject.werks));
            },

            onBeforeRebindEkpo: function (oSource) {
                var binding = oSource.getParameter("bindingParams");
                binding.filters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                binding.filters.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
            },

            onBeforeMdmaHistTableRebind: function (oSource) {
                var binding = oSource.getParameter("bindingParams");
                binding.filters.push(new Filter("Plant", FilterOperator.EQ, this.selectedObject.werks));
                binding.filters.push(new Filter("Material", FilterOperator.EQ, this.selectedObject.matnr));
                binding.filters.push(new Filter("StorageLocation", FilterOperator.EQ, this.selectedObject.lgort));
                if (!binding.sorter.length) {
                    binding.sorter.push(
                        new Sorter("ChangeDate", true),
                        new Sorter("ChangeTime", true),
                        new Sorter("ChangeNumber", true)
                    );
                }
            },

            onBeforeRebindExtended: function (oSource) {
                var binding = oSource.getParameter("bindingParams");
                binding.filters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                binding.filters.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
                binding.filters.push(new Filter("werks", FilterOperator.EQ, this.selectedObject.werks));
            },

            onBeforeRebindYearMat: function (oSource) {
                if (this.isLgort == "N") {
                    var oView = this.getView();
                    var params =
                    {
                        title: "Roční výdej materiálu za materiál  " + that.selectedObject.matnr
                    }
                    oView.setModel(new JSONModel(params), "materialYear")
                    var binding = oSource.getParameter("bindingParams");
                    binding.filters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                }
                else {
                    var oView = this.getView();
                    var params =
                    {
                        title: "Roční výdej materiálu za sklad  " + that.selectedObject.lgort + " a materiál " + that.selectedObject.matnr
                    }
                    oView.setModel(new JSONModel(params), "materialYear")
                    var binding = oSource.getParameter("bindingParams");
                    binding.filters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                    binding.filters.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
                }
            },

            onMatnrMenuPress: function (oEvent) {
                var oSource = oEvent.getSource();
                var oView = this.getView();
                this.selectedObject = oSource.getBindingContext().getObject();
                if (!this._oMenuFragment) {
                    this._oMenuFragment = Fragment.load({
                        id: oView.getId(),
                        name: "zpmckd.ext.fragment.MatnrMenuExtension",
                        controller: this
                    }).then(function (oMenu) {
                        oMenu.openBy(oSource);
                        this._oMenuFragment = oMenu;
                        return this._oMenuFragment;
                    }.bind(this));
                } else {
                    this._oMenuFragment.openBy(oSource);
                }
            },

            getSelectedItemDetail: function (sWerks, sLgort, sMatnr) {
                var oModel = this.getView().getModel();
                var aFilters = [];
                if (sWerks) aFilters.push(new Filter("werks", FilterOperator.EQ, sWerks));
                if (sLgort) aFilters.push(new Filter("lgort", FilterOperator.EQ, sLgort));
                if (sMatnr) aFilters.push(new Filter("matnr", FilterOperator.EQ, sMatnr));
                return new Promise(function (resolve, reject) {
                    oModel.read("/ZPMI_CKD_CUST", {
                        filters: aFilters,
                        success: function (oData, oResponse) {
                            resolve(oData.results[0]);
                        }
                    });
                });
            },

            onMenuAction: function (oEvent) {
                var sKey = oEvent.getParameter("item").getKey();

                switch (sKey) {
                    case "addMaterial":
                        if (!this.oMatnrNoteDialog) {
                            this.oMatnrNoteDialog = this.loadFragment({
                                name: "zpmckd.ext.fragment.MatnrPoznamkaExtension"
                            });
                        }
                        this.oMatnrNoteDialog.then(function (oMatnrNoteDialog) {
                            oMatnrNoteDialog.open();
                            oMatnrNoteDialog.setBusy(true);
                            that.getSelectedItemDetail(that.selectedObject.werks, that.selectedObject.lgort, that.selectedObject.matnr).then(function (oData) {
                                that.getView().setModel(new JSONModel(oData), "materialNoteModel");
                                oMatnrNoteDialog.setBusy(false);
                            })
                        });

                        break;

                    case "changeLimits":
                        if (!this.oHladinaDialog) {
                            this.oHladinaDialog = this.loadFragment({
                                name: "zpmckd.ext.fragment.HladinaExtension"
                            });
                        }
                        this.oHladinaDialog.then(function (oHladinaDialog) {
                            oHladinaDialog.open();
                            oHladinaDialog.setBusy(true);
                            that.getSelectedItemDetail(that.selectedObject.werks, that.selectedObject.lgort, that.selectedObject.matnr).then(function (oData) {
                                that.getView().setModel(new JSONModel(oData), "hladinaModel");
                                oHladinaDialog.setBusy(false);
                            })
                        });

                        break;

                    case "yearlyMat":
                        this.isLgort = "N"
                        if (!this.oMatnrYearDialog) {
                            this.oMatnrYearDialog = this.loadFragment({
                                name: "zpmckd.ext.fragment.MatnrYearExtension"
                            });
                        }
                        this.oMatnrYearDialog.then(function (oMatnrYearDialog) {
                            oMatnrYearDialog.open();
                        });

                        break;

                    case "yearlyMatLgort":
                        this.isLgort = "Y"
                        if (!this.oMatnrYearDialog) {
                            this.oMatnrYearDialog = this.loadFragment({
                                name: "zpmckd.ext.fragment.MatnrYearExtension"
                            });
                        }
                        this.oMatnrYearDialog.then(function (oMatnrYearDialog) {
                            oMatnrYearDialog.open();
                        });

                        break;

                    case "info":
                        if (!this.oInfoDialog) {
                            this.oInfoDialog = this.loadFragment({
                                name: "zpmckd.ext.fragment.InfoExtension"
                            });
                        }
                        this.oInfoDialog.then(function (oInfoDialog) {
                            oInfoDialog.open();
                        });

                        break;
                }
            },

            afterInfoDialogOpen: function (oEvent) {
                var that = this;
                this.oInfoDialog.then(function (oInfoDialog) {
                    that.getView().byId("infoSmartTable").getTable().getBinding("items").filter([new Filter("matnr", FilterOperator.EQ, that.selectedObject.matnr)]);
                });
            },

            onInfoCloseDialog: function () {
                this.oInfoDialog.then(function (oInfoDialog) {
                    oInfoDialog.close();
                });
            },

            onEkpoCloseDialog: function () {
                this.getView().byId("ekpoDialog").close();
            },

            ekpoDialogAfterclose: function (oEvent) {
                this.getView().byId("ekpoDialog").destroy();
                this.EkpoYearDialog = null;
            },

            onMatnrYearCloseDialog: function () {
                this.getView().byId("matnrYearDialog").close();
            },

            matnrYearDialogAfterclose: function (oEvent) {
                this.getView().byId("matnrYearDialog").destroy();
                this.oMatnrYearDialog = null;
            },

            poznamkaDialogBeforeOpen: function () {
                var oView = this.getView();
                var aFilters = [];
                aFilters.push(new Filter("werks", FilterOperator.EQ, this.selectedObject.werks));
                aFilters.push(new Filter("lgort", FilterOperator.EQ, this.selectedObject.lgort));
                aFilters.push(new Filter("matnr", FilterOperator.EQ, this.selectedObject.matnr));
                this.readMaterialNotes(aFilters).then(function (oData) {
                    oView.setModel(new JSONModel(oData), "poznamkyModel");
                })
            },

            readMaterialNotes: function (aFilters) {
                var aFilters = [];
                aFilters.push(new Filter("werks", FilterOperator.EQ, that.selectedObject.werks));
                aFilters.push(new Filter("lgort", FilterOperator.EQ, that.selectedObject.lgort));
                aFilters.push(new Filter("matnr", FilterOperator.EQ, that.selectedObject.matnr));
                var oView = that.getView();
                var oModel = that.getView().getModel();
                return new Promise(function (resolve, reject) {
                    oModel.read("/ZPMI_CKD_NOTE", {
                        filters: aFilters,
                        success: function (oData, oResponse) {
                            oView.setModel(new JSONModel(oData), "poznamkyModel")
                        }, error: function (oError) {
                            var oErrMsg = JSON.parse(oError.responseText).error.message.value;
                            if (oErrMsg) {
                                sap.m.MessageBox.error(oErrMsg);
                                console.error(oErrMsg);
                            }
                        }
                    });
                });
            },

            onHladinaAccept: function () {
                var oData = this.getView().getModel("hladinaModel").getData();
                var oModel = this.getView().getModel();
                var oParams = {
                    matnr: oData.matnr,
                    lgort: oData.lgort,
                    werks: oData.werks,
                    mabst: oData.mabst,
                    minbe: oData.minbe,
                };
                this.oHladinaDialog.then(function (oDialog) {
                    oDialog.setBusy(true);
                    return new Promise(function (resolve, reject) {
                        oModel.callFunction("/toPostMinbe", {
                            method: "POST",
                            urlParameters: oParams,
                            success: function (oResponse) {
                                oDialog.setBusy(false);
                                oDialog.close();
                                if (that._oMainSmartTable) that._oMainSmartTable.rebindTable();
                                resolve(oResponse);
                            },
                            error: function (oError) {
                                oDialog.setBusy(false);
                                var oErrMsg = JSON.parse(oError.responseText).error.message.value;
                                if (oErrMsg) {
                                    oDialog.close()
                                    sap.m.MessageBox.error(oErrMsg)
                                }
                            }
                        });
                    });
                });
            },

            onMatnrPoznamkaAccept: function (oEvent) {
                var sValue = oEvent.getParameter("value");
                if (!sValue) return;
                this.oMatnrNoteDialog.then(function (oMatnrNoteDialog) {
                    oMatnrNoteDialog.setBusy(true);
                    var oData = that.getView().getModel("materialNoteModel").getData();
                    var oParams = {
                        note: sValue,
                        matnr: oData.matnr,
                        lgort: oData.lgort,
                        werks: oData.werks,
                        guid: "00000000-0000-0000-0000-000000000000"
                    };
                    that.postMaterialNote(oParams).then(function (oResponse) {
                        that.readMaterialNotes();
                        if (that._oMainSmartTable) that._oMainSmartTable.rebindTable();
                        oMatnrNoteDialog.setBusy(false);
                    }).catch(function (oError) {
                        oMatnrNoteDialog.setBusy(false);
                    });
                });
            },

            deleteNote: function (oData) {
                var oModel = this.getView().getModel();
                return new Promise(function (resolve, reject) {
                    oModel.remove("/ZPMI_CKD_MCOM(matnr='" + oData.matnr + "',lgort='" + oData.lgort + "',werks='" + oData.werks + "',guid=guid'" + that.oSelectedNote.guid + "',note='')", {
                        success: function (oResponse) {
                            resolve(oResponse);
                        },
                        error: function (oError) {
                            var oErrMsg = JSON.parse(oError.responseText).error.message.value;
                            if (oErrMsg) {
                                sap.m.MessageBox.error(oErrMsg);
                                console.error(oErrMsg);
                            }
                            reject(oError);
                        }
                    });
                });
            },

            postMaterialNote: function (oParams) {
                var oModel = this.getView().getModel();
                return new Promise(function (resolve, reject) {
                    oModel.callFunction("/toPostNote", {
                        method: "POST",
                        urlParameters: oParams,
                        success: function (oResponse) {
                            resolve(oResponse);
                        },
                        error: function (oError) {
                            var oErrMsg = JSON.parse(oError.responseText).error.message.value;
                            if (oErrMsg) {
                                sap.m.MessageBox.error(oErrMsg);
                                console.error(oErrMsg);
                            }
                            reject(oError);
                        }
                    });
                });
            },

            onScrapSelect: function (oEvent) {
                this._toggleMardFlag(oEvent.getSource(), "Scrap", "Ke šrotaci");
            },

            onDorSelect: function (oEvent) {
                this._toggleMardFlag(oEvent.getSource(), "Dor", "Neobjednávat");
            },

            // Přepnutí příznaku materiálu na úrovni skladu v ZPMI_CKD_MARD (záznam se založí, pokud neexistuje)
            _toggleMardFlag: function (oCheckBox, sProperty, sText) {
                var oRowContext = oCheckBox.getBindingContext();
                var sWerks = oRowContext.getProperty("werks");
                var sMatnr = oRowContext.getProperty("matnr");
                var sLgort = oRowContext.getProperty("lgort");

                var oModel = oCheckBox.getModel();

                var sPath = oModel.createKey("/ZPMI_CKD_MARD", {
                    Werks: sWerks,
                    Matnr: sMatnr,
                    Lgort: sLgort
                });

                oCheckBox.setBusy(true);
                oModel.read(sPath, {
                    success: function (oData) {
                        var oUpdate = {};
                        oUpdate[sProperty] = !oData[sProperty];
                        oModel.update(sPath, oUpdate, {
                            success: function () {
                                oCheckBox.setBusy(false);
                                sap.m.MessageToast.show("Příznak " + sText + " byl úspěšně aktualizován");
                            },
                            error: function (oError) {
                                oCheckBox.setBusy(false);
                                sap.m.MessageBox.error("Aktualizace příznaku " + sText + " selhala");
                            }
                        });
                    },
                    error: function (oError) {
                        if (oError.statusCode === "404" || oError.statusCode === 404) {
                            var oCreate = {
                                Werks: sWerks,
                                Matnr: sMatnr,
                                Lgort: sLgort
                            };
                            oCreate[sProperty] = true;
                            oModel.create("/ZPMI_CKD_MARD", oCreate, {
                                success: function () {
                                    oCheckBox.setBusy(false);
                                    sap.m.MessageToast.show("Příznak " + sText + " byl úspěšně vytvořen");
                                },
                                error: function (oCreateError) {
                                    oCheckBox.setBusy(false);
                                    sap.m.MessageBox.error("Vytvoření příznaku " + sText + " selhalo");
                                }
                            });
                        } else {
                            oCheckBox.setBusy(false);
                            sap.m.MessageBox.error("Čtení příznaku " + sText + " selhalo");
                        }
                    }
                });
            },

            onSenderPress: function (oEvent) {
                var oSource = oEvent.getSource();
                this.oSelectedNote = oSource.getBindingContext("poznamkyModel").getObject();
                var oView = this.getView();
                if (!this._oNoteMenuFragment) {
                    this._oNoteMenuFragment = Fragment.load({
                        id: oView.getId(),
                        name: "zpmckd.ext.fragment.NoteMenuExtension",
                        controller: this
                    }).then(function (oNoteMenu) {
                        oNoteMenu.openBy(oSource);
                        this._oNoteMenuFragment = oNoteMenu;
                        return this._oNoteMenuFragment;
                    }.bind(this));
                } else {
                    this._oNoteMenuFragment.openBy(oSource);
                }
            },

            onNoteMenuAction: function (oEvent) {
                var sKey = oEvent.getParameter("item").getKey();
                switch (sKey) {
                    case "deleteEntry":
                        this.oMatnrNoteDialog.then(function (oMatnrNoteDialog) {
                            oMatnrNoteDialog.setBusy(true);
                            var oData = that.getView().getModel("materialNoteModel").getData();
                            that.deleteNote(oData).then(function (oResponse) {
                                that.readMaterialNotes();
                                if (that._oMainSmartTable) that._oMainSmartTable.rebindTable();
                                oMatnrNoteDialog.setBusy(false);
                            }).catch(function (oError) {
                                oMatnrNoteDialog.setBusy(false);
                            });
                        });
                        break;
                }
            },

            onPoptavkaCreate: function () {
                var oRespTable = this.getView().byId("zpmckd::sap.suite.ui.generic.template.ListReport.view.ListReport::ZPMI_CKD_CUST--responsiveTable");
                var oGridTable = this.getView().byId("zpmckd::sap.suite.ui.generic.template.ListReport.view.ListReport::ZPMI_CKD_CUST--GridTable");
                var aSelectedItems = [];

                if (oRespTable) {
                    aSelectedItems = oRespTable.getSelectedItems();
                } else if (oGridTable) {
                    var oPlugin = oGridTable.getPlugin("sap.ui.table.plugins.SelectionPlugin") ||
                        oGridTable.getPlugin("sap.ui.table.plugins.MultiSelectionPlugin");
                    var aIndices = oPlugin ? oPlugin.getSelectedIndices() : oGridTable.getSelectedIndices();
                    aSelectedItems = aIndices.map(function (iIndex) {
                        var oContext = oGridTable.getContextByIndex(iIndex);
                        return { getBindingContext: function () { return oContext; } };
                    });
                }

                // Ošetření HTML znaků v datech (např. "<" v názvu materiálu)
                var fnEscape = function (sValue) {
                    return String(sValue === undefined || sValue === null ? "" : sValue)
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
                };

                var sRowsHtml = "";
                for (var i = 0; i < aSelectedItems.length; i++) {
                    var oBindingObject = aSelectedItems[i].getBindingContext().getObject();

                    // Počet k poptání = maximální hladina - volně použitelný počet
                    // POZOR: uprav názvy polí podle vaší OData entity (mabst, labst, cdv)!
                    var fMax = parseFloat(oBindingObject.mabst) || 0;
                    var fFree = parseFloat(oBindingObject.labst) || 0;
                    var fPocet = Math.max(fMax - fFree, 0);

                    sRowsHtml +=
                        "<tr>" +
                        "<td style=\"padding:4px 16px 4px 0;vertical-align:top;\">" + fnEscape(oBindingObject.matnr) + "</td>" +
                        "<td style=\"padding:4px 16px 4px 0;vertical-align:top;\">" + fnEscape(oBindingObject.maktx) + "</td>" +
                        "<td style=\"padding:4px 16px 4px 0;vertical-align:top;\">" + fnEscape(oBindingObject.cdv) + "</td>" +
                        "<td style=\"padding:4px 16px 4px 0;vertical-align:top;\">" + fPocet + " " + fnEscape(oBindingObject.meins) + "</td>" +
                        "</tr>";
                }

                var sHtmlBody =
                    "<html><body style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;\">" +
                    "<p>Dobrý den,</p>" +
                    "<p>prosím o nezávaznou cenovou nabídku na následující materiál:</p>" +
                    "<table style=\"border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;\">" +
                    "<tr>" +
                    "<th align=\"left\" style=\"padding:4px 16px 4px 0;\">SAP</th>" +
                    "<th align=\"left\" style=\"padding:4px 16px 4px 0;\">Název materiálu</th>" +
                    "<th align=\"left\" style=\"padding:4px 16px 4px 0;\">ČDV</th>" +
                    "<th align=\"left\" style=\"padding:4px 16px 4px 0;\">Počet</th>" +
                    "</tr>" +
                    sRowsHtml +
                    "</table>" +
                    "<p><b>Cenu</b> prosím <b><span style=\"color:red;\">včetně dopravy a balného</span></b> do závodu ŠKODA AUTO a.s.<br/>" +
                    "Dále prosím uveďte <b><span style=\"color:red;\">termín dodání</span></b>.<br/>" +
                    "V případě, že tyto náklady do cenové nabídky neuvedete a vystavíte fakturu s dopravným, " +
                    "nebude Vám toto dodatečně proplaceno.</p>" +
                    "<p style=\"font-size:9pt;\">Upozorňujeme na to, že předložením Vaší nabídky nevzniká ŠKODA AUTO a.s. " +
                    "žádná povinnost k uzavření smlouvy.</p>" +
                    "<p>Děkuji předem za nabídku a přeji hezký den.</p>" +
                    "<p>S pozdravem</p>" +
                    "</body></html>";

                // Base64 s podporou UTF-8 (kvůli diakritice)
                var fnB64 = function (sText) {
                    return btoa(unescape(encodeURIComponent(sText)));
                };

                // Zalomení base64 na řádky po 76 znacích (dle RFC 2045)
                var sBodyB64 = fnB64(sHtmlBody).replace(/(.{76})/g, "$1\r\n");

                // X-Unsent: 1 zajistí, že Outlook otevře soubor jako rozepsaný koncept
                var sEml =
                    "To: \r\n" +
                    "Subject: =?utf-8?B?" + fnB64("Nezávazná cenová nabídka") + "?=\r\n" +
                    "X-Unsent: 1\r\n" +
                    "MIME-Version: 1.0\r\n" +
                    "Content-Type: text/html; charset=utf-8\r\n" +
                    "Content-Transfer-Encoding: base64\r\n" +
                    "\r\n" +
                    sBodyB64;

                var oBlob = new Blob([sEml], { type: "message/rfc822" });
                var sUrl = URL.createObjectURL(oBlob);
                var oLink = document.createElement("a");
                oLink.href = sUrl;
                oLink.download = "Poptavka.eml";
                document.body.appendChild(oLink);
                oLink.click();
                document.body.removeChild(oLink);
                URL.revokeObjectURL(sUrl);
            },

            poptavkaDialogAfterClose: function (oEvent) {
                this.getView().byId("poptavkaDialog").destroy();
                this.oPoptavkaDialog = null;
            },

            onPoptavkaCloseDialog: function () {
                this.getView().byId("poptavkaDialog").close();
            },

            objednavkaDialogAfterclose: function (oEvent) {
                this.getView().byId("objednavkaDialog").destroy();
                this.oObjednavkaDialog = null;
            },

            onObjednavkaCloseDialog: function () {
                this.getView().byId("objednavkaDialog").close();
            },

            spotrebaDialogAfterclose: function (oEvent) {
                this.getView().byId("spotrebaDialog").destroy();
                this.oSpotrebaDialog = null;
            },

            onSpotrebaCloseDialog: function () {
                this.getView().byId("spotrebaDialog").close();
            },

            kosikDialogAfterclose: function (oEvent) {
                this.getView().byId("kosikDialog").destroy();
                this.oKosikDialog = null;
            },

            onKosikCloseDialog: function () {
                this.getView().byId("kosikDialog").close();
            },

            pobjDialogAfterclose: function (oEvent) {
                this.getView().byId("pobjDialog").destroy();
                this.oPobjDialog = null;

            },

            onPobjCloseDialog: function () {
                this.getView().byId("pobjDialog").close();
            },

            onHladinaDecline: function () {
                this.getView().byId("HladinaDialog").close();
            },

            poznamkaDialogAfterClose: function (oEvent) {
                this.getView().byId("PoznamkaDialog").destroy();
                this.oMatnrNoteDialog = null;
            },

            onMatnrPoznamkaDecline: function () {
                this.getView().byId("PoznamkaDialog").close();
            },

            bdmngDialogAfterclose: function (oEvent) {
                this.getView().byId("bdmngDialog").destroy();
                this.oBdmngDialog = null;
            },

            onBdmngCloseDialog: function () {
                this.getView().byId("bdmngDialog").close();
            },

            onBeforeRebindTable: function (oEvent) {
                this._applyMatnrFilter(oEvent);
            },

            mdmaHistDialogAfterclose: function (oEvent) {
                this.getView().byId("HladinaDialog").destroy();
                this.oHladinaDialog = null;
            },

            onOpenNotes: function (oEvent) {
                this.selectedObject = oEvent.getSource().getBindingContext().getObject();
                if (!this.oMatnrNoteDialog) {
                    this.oMatnrNoteDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.MatnrPoznamkaExtension"
                    });
                }
                this.oMatnrNoteDialog.then(function (oMatnrNoteDialog) {
                    oMatnrNoteDialog.open();
                    oMatnrNoteDialog.setBusy(true);
                    that.getSelectedItemDetail(that.selectedObject.werks, that.selectedObject.lgort, that.selectedObject.matnr).then(function (oData) {
                        that.getView().setModel(new JSONModel(oData), "materialNoteModel");
                        oMatnrNoteDialog.setBusy(false);
                    })
                });
            }

        };
    });
