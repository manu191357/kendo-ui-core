(function(f, define){
    define([ "./kendo.data"], f);
})(function(){

var __meta__ = {
    id: "ganttchart",
    name: "GanttChart",
    category: "web",
    description: "The Gantt-chart component.",
    depends: [ "data" ]
};

(function($, undefined) {

    var kendo = window.kendo;
    var Widget = kendo.ui.Widget;
    var DataSource = kendo.data.DataSource;
    var Query = kendo.data.Query;
    var isArray = $.isArray;
    var proxy = $.proxy;
    var extend = $.extend;
    var each = $.each;

    var GanttChartTask = kendo.data.Model.define({

        duration: function() {
            var end = this.end;
            var start = this.start;

            return end - start;
        },

        isMilestone: function() {
            return this.duration() === 0;
        },

        _offset: function(value) {
            var field = ["start", "end"];
            var newValue;

            for (var i = 0; i < field.length; i++) {
                newValue = new Date(this.get(field[i]).getTime() + value);
                this.set(field[i], newValue);
            }
        },

        id: "id",
        fields: {
            id: { type: "number" },
            parentId: { type: "number", defaultValue: null, validation: { required: true } },
            orderId: { type: "number", validation: { required: true } },
            title: { defaultValue: "", type: "string" },
            start: { type: "date", validation: { required: true } },
            end: { type: "date", validation: { required: true } },
            percentComplete: { type: "number" },
            summary: { type: "boolean" }
        }
    });

    var GanttChartDataSource = DataSource.extend({
        init: function(options) {

            DataSource.fn.init.call(this, extend(true, {}, {
                schema: {
                    modelBase: GanttChartTask,
                    model: GanttChartTask
                }
            }, options));

        },

        remove: function(task) {
            var parentId = task.get("parentId");

            task = DataSource.fn.remove.call(this, task);
            
            this._childRemoved(parentId, task.get("orderId"));

            return task;
        },

        add: function(task) {
            return this.insert(this.taskSiblings(task).length, task);
        },

        insert: function(index, task) {
            if (!task) {
                return;
            }

            task.set("orderId", index);

            task = DataSource.fn.insert.call(this, index, task);

            this._reorderSiblings(task, this.taskSiblings(task).length - 1);
            this._updateSummary(this.taskParent(task));

            return task;
        },

        taskChildren: function(task) {
            var data = this.view();
            var filter = {
                field: "parentId",
                operator: "eq",
                value: null
            };
            var order = {
                field: "orderId",
                dir: "asc"
            };

            if (!!task) {
                filter.value = task.get("id");
            }

            data = new Query(data).filter(filter).sort(order).toArray();

            return data;
        },

        taskAllChildren: function(task) {
            var data = [];
            var that = this;
            var callback = function() {
                var tasks = that.taskChildren(arguments[1] || arguments[0]);

                data.push.apply(data, tasks);
                each(tasks, callback);
            };

            if (!!task) {
                callback(task);
            } else {
                data = this.view();
            }

            return data;
        },

        taskSiblings: function(task) {
            if (!task) {
                return null;
            }

            var parent = this.taskParent(task);

            return this.taskChildren(parent);
        },

        taskParent: function(task) {
            if (!task || task.get("parentId") === null) {
                return null;
            }
            return this.get(task.parentId);
        },

        update: function(task, taksInfo) {
            var that = this;
            var oldValue;

            var updateParents = function(task, field, callback) {
                var parent = that.taskParent(task);

                if (!parent) {
                    return;
                }

                var value = callback(parent);

                parent.set(field, value);
                updateParents(parent, field, callback);
            };

            var offsetChildren = function(parentTask, offset) {
                var children = that.taskAllChildren(parentTask);

                for (var i = 0, l = children.length; i < l; i++) {
                    children[i]._offset(offset);
                }
            };

            var updateStartCallback = function(parentTask) {
                var children = that.taskChildren(parentTask);
                var min = children[0].start.getTime();
                var currentMin;

                for (var i = 1, l = children.length; i < l; i++) {
                    currentMin = children[i].start.getTime();
                    if (currentMin < min) {
                        min = currentMin;
                    }
                }

                return new Date(min);
            };

            var updateEndCallback = function(parentTask) {
                var children = that.taskChildren(parentTask);
                var max = children[0].end.getTime();
                var currentMax;

                for (var i = 1, l = children.length; i < l; i++) {
                    currentMax = children[i].end.getTime();
                    if (currentMax > max) {
                        max = currentMax;
                    }
                }

                return new Date(max);
            };

            var updatePercentCompleteCallback = function(parentTask) {
                var children = that.taskChildren(parentTask);
                var percentComplete = new Query(children).aggregate([{
                    field: "percentComplete",
                    aggregate: "average"
                }]);

                return percentComplete[field].average;
            };

            if (taksInfo.parentId !== undefined) {
                oldValue = task.get("parentId");
                task.set("parentId", taksInfo.parentId);

                this._childRemoved(oldValue, task.get("orderId"));

                task.set("orderId", this.taskSiblings(task).length - 1);

                this._updateSummary(this.taskParent(task));

                delete taksInfo.parentId;
            }

            for (var field in taksInfo) {
                oldValue = task.get(field);

                task.set(field, taksInfo[field]);

                switch (field) {
                    case "start":
                        updateParents(task, field, updateStartCallback);
                        offsetChildren(task, task.get(field).getTime() - oldValue.getTime());
                        break;
                    case "end":
                        updateParents(task, field, updateEndCallback);
                        break;
                    case "percentComplete":
                        updateParents(task, field, updatePercentCompleteCallback);
                        break;
                    case "orderId":
                        this._reorderSiblings(task, oldValue);
                        break;
                }
            }
        },

        _childRemoved: function(parentId, index) {
            var parent = parentId === null ? null : this.get(parentId);
            var children = this.taskChildren(parent);

            for (var i = index, l = children.length; i < l; i++) {
                children[i].set("orderId", i);
            }

            this._updateSummary(parent);
        },

        _reorderSiblings: function(task, oldOrderId) {
            var orderId = task.get("orderId");
            var direction = orderId > oldOrderId;
            var startIndex = direction ? oldOrderId : orderId;
            var endIndex = direction ? orderId : oldOrderId;
            var newIndex = direction ? startIndex : startIndex + 1;
            var siblings = this.taskSiblings(task);

            endIndex = Math.min(endIndex, siblings.length - 1);

            for (var i = startIndex; i <= endIndex; i++) {
                if (siblings[i] === task) {
                    continue;
                }

                siblings[i].set("orderId", newIndex);

                newIndex += 1;
            }
        },

        _updateSummary: function(task) {
            if (task !== null) {
                var childCount = this.taskChildren(task).length;

                task.set("summary", childCount > 0);
            }
        }

    });

    GanttChartDataSource.create = function(options) {
        options = isArray(dataSource) ? { data: options } : options;

        var dataSource = options || {};
        var data = dataSource.data;

        dataSource.data = data;

        if (!(dataSource instanceof GanttChartDataSource) && dataSource instanceof DataSource) {
            throw new Error("Incorrect DataSource type. Only GanttChartDataSource instances are supported");
        }

        return dataSource instanceof GanttChartDataSource ? dataSource : new GanttChartDataSource(dataSource);
    };

    extend(true, kendo.data, {
        GanttChartDataSource: GanttChartDataSource,
        GanttChartTask: GanttChartTask
    });

    var GanttChart = Widget.extend({
        init: function(element, options) {
            if (isArray(options)) {
                options = { dataSource: options };
            }

            Widget.fn.init.call(this, element, options);

            this._dataSource();

            this._dependencies();

            if (this.options.autoBind) {
                this.dataSource.fetch();
                this.dependencies.dataSource.fetch();
            }

            kendo.notify(this);
        },

        events: [
            "dataBinding",
            "dataBound"
        ],

        options: {
            name: "GanttChart",
            autoBind: true
        },

        _dataSource: function() {
            var options = this.options;
            var dataSource = options.dataSource;

            dataSource = isArray(dataSource) ? { data: dataSource } : dataSource;

            if (this.dataSource && this._refreshHandler) {
                this.dataSource
                    .unbind("change", this._refreshHandler)
                    .unbind("error", this._errorHandler);
            } else {
                this._refreshHandler = proxy(this.refresh, this);
                this._errorHandler = proxy(this._error, this);
            }

            this.dataSource = kendo.data.GanttChartDataSource.create(dataSource)
                .bind("change", this._refreshHandler)
                .bind("error", this._errorHandler);
        },

        _dependencies: function() {
            var dependencies = this.options.dependencies || {};
            var dataSource = isArray(dependencies) ? dependencies : dependencies.dataSource;

            this.dependencies = {
                dataPredecessorField: dependencies.dataPredecessorField || "predecessorId",
                dataSuccessorField: dependencies.dataSuccessorField || "successorId",
                dataTypeField: dependencies.dataTypeField || "type",
                dataSource: kendo.data.DataSource.create(dataSource)
            };
        },

        setDataSource: function(dataSource) {
            this.options.dataSource = dataSource;

            this._dataSource();

            if (this.options.autoBind) {
                dataSource.fetch();
            }
        },

        refresh: function(e) {
            if (this.trigger("dataBinding")) {
                return;
            }

            this.trigger("dataBound");
        },

        _error: function() {

        }
    });

    kendo.ui.plugin(GanttChart);

})(window.kendo.jQuery);

return window.kendo;

}, typeof define == 'function' && define.amd ? define : function(_, f){ f(); });
