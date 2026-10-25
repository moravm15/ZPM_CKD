
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

            onDNOSelect: function (oEvent) {
                this._toggleMardFlag(oEvent.getSource(), "Dno", "Neobjednávat");
            },

            // Přepnutí příznaku materiálu na úrovni skladu v ZPMI_CKD_MARD (záznam se založí, pokud neexistuje)
            _toggleMardFlag: function (oCheckBox, sProperty, sText) {
                var oRowContext = oCheckBox.getBindingContext();

                oCheckBox.setBusy(true);
                this._upsertMard(oCheckBox.getModel(), oRowContext.getObject(), function (oData) {
                    var oValues = {};
                    oValues[sProperty] = oData ? !oData[sProperty] : true;
                    return oValues;
                }).then(function (bCreated) {
                    oCheckBox.setBusy(false);
                    sap.m.MessageToast.show("Příznak " + sText + (bCreated ? " byl úspěšně vytvořen" : " byl úspěšně aktualizován"));
                }, function (sStep) {
                    oCheckBox.setBusy(false);
                    var mErrors = {
                        read: "Čtení příznaku " + sText + " selhalo",
                        update: "Aktualizace příznaku " + sText + " selhala",
                        create: "Vytvoření příznaku " + sText + " selhalo"
                    };
                    sap.m.MessageBox.error(mErrors[sStep]);
                });
            },

            // Zápis do ZPMI_CKD_MARD - existující záznam se aktualizuje, jinak se založí.
            // fnValues dostane aktuální data záznamu (nebo null, pokud neexistuje) a vrací měněné hodnoty.
            // Promise vrací true, pokud byl záznam založen; při chybě vrací krok, který selhal (read/update/create).
            _upsertMard: function (oModel, oRow, fnValues) {
                var oKeys = {
                    Werks: oRow.werks,
                    Matnr: oRow.matnr,
                    Lgort: oRow.lgort
                };
                var sPath = oModel.createKey("/ZPMI_CKD_MARD", oKeys);

                return new Promise(function (resolve, reject) {
                    oModel.read(sPath, {
                        success: function (oData) {
                            oModel.update(sPath, fnValues(oData), {
                                success: function () { resolve(false); },
                                error: function () { reject("update"); }
                            });
                        },
                        error: function (oError) {
                            if (oError.statusCode === "404" || oError.statusCode === 404) {
                                oModel.create("/ZPMI_CKD_MARD", Object.assign({}, oKeys, fnValues(null)), {
                                    success: function () { resolve(true); },
                                    error: function () { reject("create"); }
                                });
                            } else {
                                reject("read");
                            }
                        }
                    });
                });
            },

            // Uložení poptávajícího a data poptávky k vybraným materiálům (sloupec Poptal)
            _savePoptavkaRequisitioner: function (aObjects) {
                var oModel = this.getView().getModel();
                var sUser = sap.ushell && sap.ushell.Container ? sap.ushell.Container.getUser().getId() : "";
                var oToday = new Date();
                // DATS - datum bez času, posíláme jako půlnoc UTC
                var oRequestDay = new Date(Date.UTC(oToday.getFullYear(), oToday.getMonth(), oToday.getDate()));

                return Promise.all(aObjects.map(function (oObject) {
                    return this._upsertMard(oModel, oObject, function () {
                        return {
                            Requisitioner: sUser,
                            RequestDay: oRequestDay
                        };
                    });
                }.bind(this))).then(function () {
                    if (this._oMainSmartTable) { this._oMainSmartTable.rebindTable(); }
                }.bind(this));
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

            // Texty poptávky podle jazyka (číselník jazyků v dialogu)
            _mPoptavkaTexts: {
                CS: {
                    nazev: "Český jazyk",
                    subject: "Nezávazná cenová nabídka",
                    fileName: "Poptavka.eml",
                    colSap: "SAP",
                    colName: "Název materiálu",
                    colCdv: "ČDV",
                    colQty: "Počet",
                    colFoto: "Foto",
                    body: "<p>Dobrý den,</p>" +
                        "<p>prosím o nezávaznou cenovou nabídku na následující materiál:</p>",
                    footer: "<p><b>Cenu</b> prosím <b><span style=\"color:red;\">včetně dopravy a balného</span></b> do závodu ŠKODA AUTO a.s.<br/>" +
                        "Dále prosím uveďte <b><span style=\"color:red;\">termín dodání</span></b>.<br/>" +
                        "V případě, že tyto náklady do cenové nabídky neuvedete a vystavíte fakturu s dopravným, " +
                        "nebude Vám toto dodatečně proplaceno.</p>" +
                        "<p style=\"font-size:9pt;\">Upozorňujeme na to, že předložením Vaší nabídky nevzniká ŠKODA AUTO a.s. " +
                        "žádná povinnost k uzavření smlouvy.</p>" +
                        "<p>Děkuji předem za nabídku a přeji hezký den.</p>" +
                        "<p>S pozdravem</p>"
                },
                DE: {
                    nazev: "Německý jazyk",
                    subject: "Unverbindliches Preisangebot",
                    fileName: "Anfrage.eml",
                    colSap: "SAP",
                    colName: "Materialbezeichnung",
                    colCdv: "Herstellerteilenummer",
                    colQty: "Menge",
                    colFoto: "Foto",
                    body: "<p>Sehr geehrte Damen und Herren,</p>" +
                        "<p>bitte senden Sie uns ein unverbindliches Preisangebot für folgendes Material:</p>",
                    footer: "<p>Bitte geben Sie den <b>Preis</b> <b><span style=\"color:red;\">inklusive Transport- und Verpackungskosten</span></b> an das Werk ŠKODA AUTO a.s. an.<br/>" +
                        "Bitte nennen Sie uns außerdem den <b><span style=\"color:red;\">Liefertermin</span></b>.<br/>" +
                        "Sollten Sie diese Kosten im Angebot nicht angeben und eine Rechnung mit Frachtkosten ausstellen, " +
                        "werden diese nachträglich nicht erstattet.</p>" +
                        "<p style=\"font-size:9pt;\">Wir weisen darauf hin, dass durch die Abgabe Ihres Angebots für die ŠKODA AUTO a.s. " +
                        "keine Verpflichtung zum Vertragsabschluss entsteht.</p>" +
                        "<p>Vielen Dank im Voraus für Ihr Angebot. Ich wünsche Ihnen einen schönen Tag.</p>" +
                        "<p>Mit freundlichen Grüßen</p>"
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

                // Data vybraných řádků si uložíme, dialog je zpracuje až po volbě jazyka
                this._aPoptavkaObjects = aSelectedItems.map(function (oItem) {
                    return oItem.getBindingContext().getObject();
                }).filter(Boolean);

                var mTexts = this._mPoptavkaTexts;
                this.getView().setModel(new JSONModel({
                    kontakt: "",
                    jazyk: "CS",
                    jazyky: Object.keys(mTexts).map(function (sKey) {
                        return { key: sKey, text: mTexts[sKey].nazev };
                    })
                }), "poptavkaModel");

                if (!this.oPoptavkaDialog) {
                    this.oPoptavkaDialog = this.loadFragment({
                        name: "zpmckd.ext.fragment.PoptavkaExtension"
                    });
                }
                this.oPoptavkaDialog.then(function (oDialog) {
                    oDialog.open();
                });
            },

            onPoptavkaConfirm: function () {
                var sJazyk = this.getView().getModel("poptavkaModel").getProperty("/jazyk");
                var oDialog = this.getView().byId("poptavkaDialog");
                oDialog.setBusy(true);
                var aObjects = this._aPoptavkaObjects || [];
                this._createPoptavkaEml(aObjects, sJazyk).then(function () {
                    oDialog.setBusy(false);
                    oDialog.close();
                    this._savePoptavkaRequisitioner(aObjects).catch(function () {
                        MessageBox.error("Uložení poptávajícího selhalo");
                    });
                }.bind(this), function () {
                    oDialog.setBusy(false);
                    MessageBox.error("Vytvoření poptávky selhalo");
                });
            },

            // Velikost fotky v e-mailu (zobrazení v px); fotka se uloží v dvojnásobném rozlišení kvůli ostrosti
            _iPoptavkaImgWidth: 107,
            _iPoptavkaImgHeight: 80,

            // Rozměry pro zobrazení - poměr stran zachován, nikdy nezvětšujeme
            _fitPoptavkaImage: function (iWidth, iHeight, iMaxWidth, iMaxHeight) {
                var fScale = Math.min(iMaxWidth / iWidth, iMaxHeight / iHeight, 1);
                return {
                    width: Math.max(Math.round(iWidth * fScale), 1),
                    height: Math.max(Math.round(iHeight * fScale), 1)
                };
            },

            // Načtení fotky jako zmenšeného JPEG v base64, aby šla vložit přímo do e-mailu (dodavatel nemá přístup na interní URL).
            // Pokud stažení selže (např. CORS na serveru s fotkami), vrací jen rozměry pro odkaz na interní URL.
            _loadPoptavkaImage: function (sUrl) {
                var iMaxWidth = this._iPoptavkaImgWidth;
                var iMaxHeight = this._iPoptavkaImgHeight;
                var fnFit = this._fitPoptavkaImage;

                var fnLoadImg = function (sSrc) {
                    return new Promise(function (resolve, reject) {
                        var oImg = new Image();
                        oImg.onload = function () { resolve(oImg); };
                        oImg.onerror = reject;
                        oImg.src = sSrc;
                    });
                };

                return fetch(sUrl, { credentials: "include" }).then(function (oResponse) {
                    if (!oResponse.ok) { throw new Error(oResponse.status); }
                    return oResponse.blob();
                }).then(function (oBlob) {
                    if (oBlob.type.indexOf("image/") !== 0) { throw new Error(oBlob.type); }
                    var sBlobUrl = URL.createObjectURL(oBlob);
                    return fnLoadImg(sBlobUrl).then(function (oImg) {
                        URL.revokeObjectURL(sBlobUrl);
                        var oSize = fnFit(oImg.naturalWidth, oImg.naturalHeight, iMaxWidth, iMaxHeight);
                        var oCanvas = document.createElement("canvas");
                        oCanvas.width = oSize.width * 2;
                        oCanvas.height = oSize.height * 2;
                        var oCtx = oCanvas.getContext("2d");
                        // Bílé pozadí kvůli průhledným PNG (JPEG průhlednost nemá)
                        oCtx.fillStyle = "#fff";
                        oCtx.fillRect(0, 0, oCanvas.width, oCanvas.height);
                        oCtx.drawImage(oImg, 0, 0, oCanvas.width, oCanvas.height);
                        return {
                            type: "image/jpeg",
                            base64: oCanvas.toDataURL("image/jpeg", 0.85).split(",")[1],
                            width: oSize.width,
                            height: oSize.height
                        };
                    }, function (oError) {
                        URL.revokeObjectURL(sBlobUrl);
                        throw oError;
                    });
                }).catch(function () {
                    // Rozměry jdou zjistit i bez CORS, obsah fotky ale ne
                    return fnLoadImg(sUrl).then(function (oImg) {
                        var oSize = fnFit(oImg.naturalWidth, oImg.naturalHeight, iMaxWidth, iMaxHeight);
                        return { width: oSize.width, height: oSize.height };
                    }, function () {
                        return { width: iMaxWidth, height: iMaxHeight };
                    });
                });
            },

            // Názvy materiálů v jazyce poptávky z ZPMI_CKD_MAT_DESC (Language v ISO, např. "DE") - mapa matnr -> název
            _readPoptavkaDescriptions: function (aObjects, sJazyk) {
                var aMatnr = [];
                aObjects.forEach(function (oObject) {
                    if (aMatnr.indexOf(oObject.matnr) === -1) { aMatnr.push(oObject.matnr); }
                });
                if (!aMatnr.length) { return Promise.resolve({}); }

                var oModel = this.getView().getModel();
                return new Promise(function (resolve) {
                    oModel.read("/ZPMI_CKD_MAT_DESC", {
                        filters: [new Filter({
                            filters: [
                                new Filter("Language", FilterOperator.EQ, sJazyk),
                                new Filter({
                                    filters: aMatnr.map(function (sMatnr) {
                                        return new Filter("Product", FilterOperator.EQ, sMatnr);
                                    }),
                                    and: false
                                })
                            ],
                            and: true
                        })],
                        urlParameters: { "$top": aMatnr.length },
                        success: function (oData) {
                            var mNazvy = {};
                            oData.results.forEach(function (oDesc) {
                                if (oDesc.ProductDescription) { mNazvy[oDesc.Product] = oDesc.ProductDescription; }
                            });
                            resolve(mNazvy);
                        },
                        // Bez překladů poptávku nezastavujeme - použije se český název
                        error: function () {
                            resolve({});
                        }
                    });
                });
            },

            _createPoptavkaEml: function (aObjects, sJazyk) {
                var oTexts = this._mPoptavkaTexts[sJazyk] || this._mPoptavkaTexts.CS;

                // Ošetření HTML znaků v datech (např. "<" v názvu materiálu)
                var fnEscape = function (sValue) {
                    return String(sValue === undefined || sValue === null ? "" : sValue)
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/"/g, "&quot;");
                };

                // Base64 s podporou UTF-8 (kvůli diakritice)
                var fnB64 = function (sText) {
                    return btoa(unescape(encodeURIComponent(sText)));
                };

                // Zalomení base64 na řádky po 76 znacích (dle RFC 2045)
                var fnWrap = function (sB64) {
                    return sB64.replace(/(.{76})/g, "$1\r\n");
                };

                // Každou fotku stáhneme jen jednou
                var aUrls = [];
                aObjects.forEach(function (oObject) {
                    if (oObject.picture && aUrls.indexOf(oObject.picture) === -1) { aUrls.push(oObject.picture); }
                });

                return Promise.all([
                    Promise.all(aUrls.map(this._loadPoptavkaImage.bind(this))),
                    this._readPoptavkaDescriptions(aObjects, sJazyk)
                ]).then(function (aResults) {
                    var aImages = aResults[0];
                    var mNazvy = aResults[1];
                    var aParts = [];
                    var mImg = {};
                    var iNotEmbedded = 0;
                    aUrls.forEach(function (sUrl, i) {
                        var oImage = aImages[i];
                        if (oImage.base64) {
                            var sCid = "foto" + (i + 1) + "@zpmckd";
                            mImg[sUrl] = { src: "cid:" + sCid, width: oImage.width, height: oImage.height };
                            aParts.push({ cid: sCid, name: "foto" + (i + 1) + ".jpg", image: oImage });
                        } else {
                            // Fotku se nepodařilo stáhnout - ponecháme odkaz (zobrazí se jen v interní síti)
                            mImg[sUrl] = { src: new URL(sUrl, window.location.href).href, width: oImage.width, height: oImage.height };
                            iNotEmbedded++;
                        }
                    });
                    if (iNotEmbedded) {
                        MessageBox.warning("Počet fotek, které se nepodařilo vložit do e-mailu: " + iNotEmbedded +
                            ". Fotky jsou v e-mailu jen jako odkaz a příjemce mimo síť ŠKODA AUTO je neuvidí.");
                    }

                    var sTd = "<td style=\"padding:4px 16px 4px 0;vertical-align:top;\">";
                    var sTh = "<th align=\"left\" style=\"padding:4px 16px 4px 0;\">";

                    var sRowsHtml = "";
                    aObjects.forEach(function (oObject) {
                        // Počet k poptání = maximální hladina - volně použitelný počet
                        var fMax = parseFloat(oObject.mabst) || 0;
                        var fFree = parseFloat(oObject.labst) || 0;
                        var fPocet = Math.max(fMax - fFree, 0);

                        // Název v jazyce poptávky, pokud chybí, tak český
                        var sNazev = mNazvy[oObject.matnr] || oObject.maktx;

                        // Rozměry i jako atributy - Outlook (desktop) CSS max-width/max-height ignoruje
                        var oImg = mImg[oObject.picture];
                        var sFoto = oImg ?
                            "<img src=\"" + fnEscape(oImg.src) + "\" alt=\"\" width=\"" + oImg.width + "\" height=\"" + oImg.height +
                            "\" style=\"width:" + oImg.width + "px;height:" + oImg.height + "px;\"/>" : "";

                        sRowsHtml +=
                            "<tr>" +
                            sTd + fnEscape(oObject.matnr) + "</td>" +
                            sTd + fnEscape(sNazev) + "</td>" +
                            sTd + fnEscape(oObject.mfrpn) + "</td>" +
                            sTd + fPocet + " " + fnEscape(oObject.meins) + "</td>" +
                            sTd + sFoto + "</td>" +
                            "</tr>";
                    });

                    var sHtmlBody =
                        "<html><body style=\"font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000;\">" +
                        oTexts.body +
                        "<table style=\"border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;\">" +
                        "<tr>" +
                        sTh + oTexts.colSap + "</th>" +
                        sTh + oTexts.colName + "</th>" +
                        sTh + oTexts.colCdv + "</th>" +
                        sTh + oTexts.colQty + "</th>" +
                        sTh + oTexts.colFoto + "</th>" +
                        "</tr>" +
                        sRowsHtml +
                        "</table>" +
                        oTexts.footer +
                        "</body></html>";

                    // X-Unsent: 1 zajistí, že Outlook otevře soubor jako rozepsaný koncept
                    var sBoundary = "----=_zpmckd_" + Date.now();
                    var sEml =
                        "To: \r\n" +
                        "Subject: =?utf-8?B?" + fnB64(oTexts.subject) + "?=\r\n" +
                        "X-Unsent: 1\r\n" +
                        "MIME-Version: 1.0\r\n" +
                        "Content-Type: multipart/related; type=\"text/html\"; boundary=\"" + sBoundary + "\"\r\n" +
                        "\r\n" +
                        "--" + sBoundary + "\r\n" +
                        "Content-Type: text/html; charset=utf-8\r\n" +
                        "Content-Transfer-Encoding: base64\r\n" +
                        "\r\n" +
                        fnWrap(fnB64(sHtmlBody)) + "\r\n";

                    // Fotky jako vložené přílohy (inline), na které odkazuje HTML přes cid:
                    aParts.forEach(function (oPart) {
                        sEml +=
                            "--" + sBoundary + "\r\n" +
                            "Content-Type: " + oPart.image.type + "; name=\"" + oPart.name + "\"\r\n" +
                            "Content-Transfer-Encoding: base64\r\n" +
                            "Content-ID: <" + oPart.cid + ">\r\n" +
                            "Content-Disposition: inline; filename=\"" + oPart.name + "\"\r\n" +
                            "\r\n" +
                            fnWrap(oPart.image.base64) + "\r\n";
                    });
                    sEml += "--" + sBoundary + "--\r\n";

                    var oBlob = new Blob([sEml], { type: "message/rfc822" });
                    var sUrl = URL.createObjectURL(oBlob);
                    var oLink = document.createElement("a");
                    oLink.href = sUrl;
                    oLink.download = oTexts.fileName;
                    document.body.appendChild(oLink);
                    oLink.click();
                    document.body.removeChild(oLink);
                    URL.revokeObjectURL(sUrl);
                });
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
